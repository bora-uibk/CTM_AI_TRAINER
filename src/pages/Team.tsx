import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, Trophy, Loader, Clock, Play, Settings, CircleCheck as CheckCircle, Circle as XCircle, Timer, Target, Award, Trash2, Sparkles, SquareCheck as CheckSquare, Square, Type, Check, ArrowRightLeft } from 'lucide-react'

// Extended interface to handle owner_team_id
interface GameQuestion extends QuizQuestion {
  owner_team_id?: number;
}

interface ExtendedTeamRoom extends TeamRoom {
  feedback?: {
    summary?: string;
    weak_points?: string[];
    strengths?: string[];
    detailed_analysis?: string;
  } | null;
}

export default function Team() {
  const { user } = useAuth()
   
  // --- State ---
  const [rooms, setRooms] = useState<ExtendedTeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<ExtendedTeamRoom | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
   
  // Modal / Form State
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [loading, setLoading] = useState(false)
   
  // Game State
  const [selectedAnswer, setSelectedAnswer] = useState<string | number | number[] | null>(null)
  // selectedTeam state is no longer used for the initial join modal, but kept if needed for logic logic
  const [selectedTeam, setSelectedTeam] = useState<number>(1)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())

  // Settings
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60
  })

  // --- Effects ---
  useEffect(() => {
    fetchRooms()
    const saved = localStorage.getItem('selectedDocuments')
    if (saved) {
      setSelectedDocuments(new Set(JSON.parse(saved)))
    }
  }, [])

  useEffect(() => {
    if (currentRoom) {
      fetchParticipants()
      const unsubscribe = subscribeToRoomUpdates()
      return () => { if (unsubscribe) unsubscribe() }
    }
  }, [currentRoom?.id])

  // Game Engine (Host Only)
  useEffect(() => {
    if (!currentRoom || !user || currentRoom.room_status !== 'in_progress') return

    if (currentRoom.created_by === user.id) {
        if (currentRoom.team_questions && Object.keys(currentRoom.team_questions).length > 0) {
            checkTeamConsensus()
        }
    }
  }, [currentRoom, participants]) 

  // Timer
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (timerActive && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            handleTimeUp()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [timerActive, timeRemaining])

  // --- Data Fetching ---
  const fetchRooms = async () => {
    try {
      const { data, error } = await supabase
        .from('team_rooms')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
      if (error) throw error
      setRooms(data || [])
    } catch (error) {
      console.error('Error fetching rooms:', error)
    }
  }

  const fetchParticipants = async () => {
    if (!currentRoom) return
    try {
      const { data, error } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', currentRoom.id)
      if (error) throw error
      setParticipants(data || [])
    } catch (error) {
      console.error('Error fetching participants:', error)
    }
  }

  const subscribeToRoomUpdates = () => {
    if (!currentRoom) return

    const channel = supabase
      .channel(`room-updates-${currentRoom.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'team_rooms', filter: `id=eq.${currentRoom.id}` }, (payload) => {
          if (payload.new) {
            const updatedRoom = payload.new as ExtendedTeamRoom
            setCurrentRoom(prevRoom => {
                if (!prevRoom) return updatedRoom;
                
                const preservedQuestions = (updatedRoom.team_questions && Object.keys(updatedRoom.team_questions).length > 0)
                    ? updatedRoom.team_questions : prevRoom.team_questions;
                const preservedFeedback = updatedRoom.feedback || prevRoom.feedback;

                const mergedRoom = { 
                    ...updatedRoom, 
                    team_questions: preservedQuestions,
                    feedback: preservedFeedback
                };

                // State reset on turn change
                const prevQ = prevRoom.current_question as GameQuestion;
                const nextQ = mergedRoom.current_question as GameQuestion;
                
                if (prevQ?.question !== nextQ?.question || mergedRoom.current_turn_team_id !== prevRoom.current_turn_team_id) {
                     setSelectedAnswer(null)
                }
                
                // Timer Logic
                if (mergedRoom.room_status === 'in_progress') {
                   if (mergedRoom.current_turn_team_id !== prevRoom.current_turn_team_id || 
                       mergedRoom.current_question_index !== prevRoom.current_question_index) {
                       setTimeRemaining(mergedRoom.time_per_question)
                       setTimerActive(true)
                   }
                } else {
                  setTimerActive(false)
                }

                return mergedRoom;
            })
          }
        }
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'team_rooms', filter: `id=eq.${currentRoom.id}` }, () => {
           alert('The room has been closed by the host.')
           setCurrentRoom(null)
           setParticipants([])
           fetchRooms()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${currentRoom.id}` }, () => {
          fetchParticipants()
      })
      .subscribe()

    return () => { channel.unsubscribe() }
  }

  // --- Actions ---
  const createRoom = async () => {
    if (!roomName.trim() || !user) return
    setLoading(true)
    try {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase()
      const { data, error } = await supabase
        .from('team_rooms')
        .insert({
          name: roomName.trim(),
          code,
          created_by: user.id,
          is_active: true,
          num_teams: 2,
          questions_per_team: roomSettings.questionsPerTeam,
          time_per_question: roomSettings.timePerQuestion,
          current_turn_team_id: 1,
          current_question_index: 0,
          team_questions: {},
          team_scores: {},
          room_status: 'lobby',
          current_question: null,
          current_answers: {},
          feedback: null
        })
        .select().single()

      if (error) throw error

      await supabase.from('room_participants').insert({
        room_id: data.id,
        user_id: user.id,
        user_email: user.email || '',
        team_number: 1 // Host defaults to Team 1
      })

      setCurrentRoom(data)
      setShowCreateRoom(false)
      setRoomName('')
      fetchRooms()
    } catch (error) {
      console.error('Error creating room:', error)
    } finally {
      setLoading(false)
    }
  }

  const deleteRoom = async (roomId: string) => {
    if (!user) return
    if (!window.confirm("Are you sure?")) return
    setLoading(true)
    try {
      await supabase.from('team_rooms').delete().eq('id', roomId).eq('created_by', user.id)
      setRooms(prev => prev.filter(r => r.id !== roomId))
      if (currentRoom?.id === roomId) {
        setCurrentRoom(null)
        setParticipants([])
      }
    } catch (error) {
      console.error('Error deleting room:', error)
    } finally {
      setLoading(false)
    }
  }

  const joinRoom = async () => {
    if (!roomCode.trim() || !user) return
    setLoading(true)
    try {
      const { data: room, error: roomError } = await supabase
        .from('team_rooms')
        .select('*')
        .eq('code', roomCode.trim().toUpperCase())
        .eq('is_active', true)
        .single()
      if (roomError) throw new Error('Room not found')

      const { data: existing } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        // UPDATED: Automatically assign to Team 1 on join, allow switching in lobby
        await supabase.from('room_participants').insert({
            room_id: room.id,
            user_id: user.id,
            user_email: user.email || '',
            team_number: 1 
          })
      }
      setCurrentRoom(room)
      setShowJoinRoom(false)
      setRoomCode('')
    } catch (error: any) {
      alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  const switchTeam = async (newTeamId: number) => {
    if (!currentRoom || !user) return
    try {
        await supabase.from('room_participants')
            .update({ team_number: newTeamId })
            .eq('room_id', currentRoom.id)
            .eq('user_id', user.id)
        // Optimistic update of local state handled by subscription
    } catch (error) {
        console.error('Error switching teams:', error)
    }
  }

  const leaveRoom = async () => {
    if (!currentRoom || !user) return
    try {
      await supabase.from('room_participants').delete().eq('room_id', currentRoom.id).eq('user_id', user.id)
      setCurrentRoom(null)
      setParticipants([])
      setSelectedAnswer(null)
      setTimerActive(false)
    } catch (error) {
      console.error(error)
    }
  }

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    setLoading(true)
    try {
      const totalQuestions = 2 * currentRoom.questions_per_team
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { count: totalQuestions, selectedDocuments: Array.from(selectedDocuments) }
      })
      if (error) throw error
      
      const teamQuestions: Record<string, QuizQuestion[]> = {}
      const teamScores: Record<string, number> = { "1": 0, "2": 0 }
      teamQuestions["1"] = data.questions.slice(0, currentRoom.questions_per_team)
      teamQuestions["2"] = data.questions.slice(currentRoom.questions_per_team, totalQuestions)
      
      const firstQ = { ...teamQuestions["1"][0], owner_team_id: 1 }

      await supabase.from('team_rooms').update({
        room_status: 'in_progress',
        team_questions: teamQuestions,
        team_scores: teamScores,
        current_turn_team_id: 1,
        current_question_index: 0,
        current_question: firstQ,
        current_answers: {},
        feedback: null
      }).eq('id', currentRoom.id)

      // Optimistic update
      setCurrentRoom(prev => prev ? {
          ...prev, 
          room_status: 'in_progress', 
          team_questions: teamQuestions, 
          current_question: firstQ
      } : null)

      setTimeRemaining(currentRoom.time_per_question)
      setTimerActive(true)
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    if (!currentRoom || !user || selectedAnswer === null) return
    try {
      const currentAnswers = currentRoom.current_answers || {}
      currentAnswers[user.id] = {
        answer: selectedAnswer,
        user_email: user.email,
        team_number: participants.find(p => p.user_id === user.id)?.team_number
      }
      await supabase.from('team_rooms').update({ current_answers: currentAnswers }).eq('id', currentRoom.id)
    } catch (error) {
      console.error(error)
    }
  }

  // --- Logic: Multi-Select Toggle ---
  const handleMultiChoiceSelect = (index: number) => {
    // Cannot change answer after submitting or if not your turn
    if (hasAnswered || !isUserTurn) return;

    const current = (Array.isArray(selectedAnswer) ? selectedAnswer : []) as number[]
    let newSelection;
    if (current.includes(index)) {
      newSelection = current.filter(i => i !== index)
    } else {
      newSelection = [...current, index].sort((a, b) => a - b)
    }
    setSelectedAnswer(newSelection)
  }

  // --- Logic: Consensus ---
  const checkTeamConsensus = async () => {
    if (!currentRoom) return
    const currentTeamMembers = participants.filter(p => p.team_number === currentRoom.current_turn_team_id)
    if (currentTeamMembers.length === 0) return

    const currentAnswers = currentRoom.current_answers || {}
    const teamAnswers = currentTeamMembers.map(m => currentAnswers[m.user_id]).filter(a => a !== undefined)

    if (teamAnswers.length === currentTeamMembers.length && teamAnswers.length > 0) {
        const firstAnswer = teamAnswers[0]?.answer
        
        // Strict equality check handles string inputs and arrays
        const allSame = teamAnswers.every(answer => {
            if (Array.isArray(answer.answer) && Array.isArray(firstAnswer)) {
                return JSON.stringify([...answer.answer].sort()) === JSON.stringify([...firstAnswer].sort())
            }
            // For inputs, normalize
            if (typeof answer.answer === 'string') {
               return String(answer.answer).trim().toLowerCase() === String(firstAnswer).trim().toLowerCase()
            }
            return answer.answer == firstAnswer
        })

        if (allSame) {
            console.log('✅ Consensus reached')
            setTimeout(() => advanceToNextQuestion(firstAnswer), 1000)
        }
    }
  }

  const advanceToNextQuestion = async (teamAnswer: any) => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    if (!currentRoom.team_questions) return // Safety

    const currentQ = currentRoom.current_question as GameQuestion;
    if (!currentQ) return;

    try {
        const currentTeam = currentRoom.current_turn_team_id
        const correctAns = currentQ.correct_answer
        const type = currentQ.type

        // Check Logic
        let isCorrect = false
        if (type === 'single_choice') {
             isCorrect = Number(teamAnswer) === Number(correctAns)
        } else if (type === 'multi_choice') {
             const u = Array.isArray(teamAnswer) ? teamAnswer.sort().toString() : ''
             const c = Array.isArray(correctAns) ? (correctAns as number[]).sort().toString() : ''
             isCorrect = u === c
        } else {
             // Input/Numerical
             isCorrect = String(teamAnswer).trim().toLowerCase() === String(correctAns).trim().toLowerCase()
        }

        const originalOwner = currentQ.owner_team_id || currentTeam
        const isStealAttempt = currentTeam !== originalOwner
        
        let nextTeam = currentTeam
        let nextIndex = currentRoom.current_question_index
        let nextQuestion = null
        const teamScores = { ...currentRoom.team_scores }
        
        if (isCorrect) {
            // Award point
            teamScores[currentTeam] = (teamScores[currentTeam] || 0) + 1
        
            if (isStealAttempt) {
                // Correct steal → keep turn, move to next question
                nextTeam = currentTeam
                nextIndex++
            } else {
                // Correct own → switch team, advance when team 2 finishes
                nextTeam = (currentTeam % 2) + 1
                if (currentTeam === 2) nextIndex++
            }
        
            nextQuestion = getQuestionFromDeck(currentRoom.team_questions, nextTeam, nextIndex)
        
        } else {
            // ❌ Wrong Answer
            if (!isStealAttempt) {
                // Wrong by owner → allow ONE steal attempt
                nextTeam = (currentTeam % 2) + 1
                nextQuestion = currentQ  // SAME question; steal round begins
            } else {
                // Wrong by stealing team → steal attempt OVER
                // return control to owner and move forward
                nextTeam = originalOwner
                nextIndex++
                nextQuestion = getQuestionFromDeck(currentRoom.team_questions, nextTeam, nextIndex)
            }
        }

        if (nextIndex >= currentRoom.questions_per_team) {
            // Finish Game
            await supabase.from('team_rooms').update({
                room_status: 'finished', 
                team_scores: teamScores, 
                current_answers: {},
                updated_at: new Date().toISOString()
            }).eq('id', currentRoom.id)
            
            // Trigger Feedback AI
            supabase.functions.invoke('generate-feedback', {
                body: { scores: teamScores, questions: currentRoom.team_questions }
            }).then(({ data }) => {
                if(data) supabase.from('team_rooms').update({ feedback: data }).eq('id', currentRoom.id)
            })

        } else {
            if (nextQuestion && !nextQuestion.owner_team_id) {
                (nextQuestion as GameQuestion).owner_team_id = originalOwner
            }
            
            await supabase.from('team_rooms').update({
                current_turn_team_id: nextTeam,
                current_question_index: nextIndex,
                current_question: nextQuestion || null, 
                current_answers: {}, 
                team_scores: teamScores
            }).eq('id', currentRoom.id)
        }
    } catch (error) { console.error(error) }
  }

  const getQuestionFromDeck = (allQuestions: any, teamId: number, index: number) => {
    const list = allQuestions[teamId.toString()] || []
    const q = list[index]
    if (q) return { ...q, owner_team_id: teamId }
    return null
  }

  const handleTimeUp = async () => {
    setTimerActive(false)
    if (user?.id === currentRoom?.created_by) {
      await advanceToNextQuestion('PASS')
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // --- Derived State for Rendering ---
  const isRoomCreator = currentRoom?.created_by === user?.id
  const currentQuestion = currentRoom?.current_question as GameQuestion | null
  const currentAnswers = currentRoom?.current_answers || {}
  const userParticipant = participants.find(p => p.user_id === user?.id)
  const isUserTurn = userParticipant?.team_number === currentRoom?.current_turn_team_id
  const hasAnswered = user?.id && currentAnswers[user.id]

  const isStealMode = currentQuestion && currentQuestion.owner_team_id && currentQuestion.owner_team_id !== currentRoom?.current_turn_team_id
  const currentTeamMembers = participants.filter(p => p.team_number === currentRoom?.current_turn_team_id)
  const teamAnswers = currentTeamMembers.map(m => currentAnswers[m.user_id]).filter(a => a !== undefined)
  
  const hasConsensus = teamAnswers.length === currentTeamMembers.length && teamAnswers.length > 0 && teamAnswers.every(a => {
      if (Array.isArray(a.answer) && Array.isArray(teamAnswers[0]?.answer)) {
          return JSON.stringify(a.answer.sort()) === JSON.stringify(teamAnswers[0]?.answer.sort())
      }
      return String(a.answer).toLowerCase() == String(teamAnswers[0]?.answer).toLowerCase()
  })

  // --- VIEW: LOBBY / TEAM SELECTION ---
  if (currentRoom && currentRoom.room_status === 'lobby') {
    return (
        <div className="max-w-4xl mx-auto space-y-6 px-4">
            {/* Lobby Header */}
            <div className="card text-center py-8">
                <h1 className="text-3xl font-bold mb-2">{currentRoom.name}</h1>
                <div className="inline-block bg-primary-50 px-6 py-3 rounded-lg border border-primary-100">
                    <p className="text-sm text-gray-500 uppercase tracking-wider font-bold mb-1">Room Code</p>
                    <p className="text-4xl font-mono font-bold text-primary-600 tracking-widest">{currentRoom.code}</p>
                </div>
                {isRoomCreator && (
                    <div className="mt-8 flex justify-center space-x-4">
                        <button onClick={startGame} className="btn-primary px-8 py-3 text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all">
                            <Play className="w-5 h-5 mr-2" /> Start Game
                        </button>
                        <button onClick={() => deleteRoom(currentRoom.id)} className="btn-secondary text-red-600">
                            Delete Room
                        </button>
                    </div>
                )}
                 {!isRoomCreator && <div className="mt-4 text-gray-500 animate-pulse">Waiting for host to start...</div>}
            </div>

            {/* Team Selection Area */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2].map(teamNum => {
                    const teamMembers = participants.filter(p => p.team_number === teamNum);
                    const isMyTeam = userParticipant?.team_number === teamNum;
                    
                    return (
                        <div key={teamNum} className={`card border-t-4 ${teamNum === 1 ? 'border-t-blue-500' : 'border-t-red-500'} flex flex-col h-full`}>
                            <div className="flex justify-between items-center mb-4 border-b pb-3">
                                <h2 className="text-xl font-bold flex items-center">
                                    <Users className={`w-5 h-5 mr-2 ${teamNum === 1 ? 'text-blue-500' : 'text-red-500'}`} />
                                    Team {teamNum}
                                </h2>
                                <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm font-bold">{teamMembers.length} Users</span>
                            </div>
                            
                            <div className="flex-grow space-y-2 mb-6">
                                {teamMembers.length === 0 ? (
                                    <p className="text-gray-400 italic text-center py-4">No players yet</p>
                                ) : (
                                    teamMembers.map(p => (
                                        <div key={p.id} className="flex items-center p-2 rounded bg-gray-50">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 font-bold text-white ${teamNum === 1 ? 'bg-blue-400' : 'bg-red-400'}`}>
                                                {p.user_email?.charAt(0).toUpperCase()}
                                            </div>
                                            <span className={p.user_id === user?.id ? 'font-bold' : ''}>
                                                {p.user_email} {p.user_id === user?.id && '(You)'}
                                            </span>
                                            {currentRoom.created_by === p.user_id && <Crown className="w-4 h-4 ml-auto text-yellow-500" />}
                                        </div>
                                    ))
                                )}
                            </div>

                            {!isMyTeam ? (
                                <button 
                                    onClick={() => switchTeam(teamNum)}
                                    className={`w-full py-3 rounded-lg font-bold border-2 transition-colors flex items-center justify-center ${
                                        teamNum === 1 
                                        ? 'border-blue-500 text-blue-600 hover:bg-blue-50' 
                                        : 'border-red-500 text-red-600 hover:bg-red-50'
                                    }`}
                                >
                                    <ArrowRightLeft className="w-4 h-4 mr-2" />
                                    Switch to Team {teamNum}
                                </button>
                            ) : (
                                <div className="text-center py-3 bg-gray-50 rounded-lg text-gray-500 font-medium cursor-default border border-gray-200">
                                    You are in this team
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
            
            <div className="text-center">
                 <button onClick={leaveRoom} className="text-gray-500 hover:text-gray-700 underline">Leave Room</button>
            </div>
        </div>
    )
  }

  // --- VIEW: FINISHED ---
  if (currentRoom?.room_status === 'finished') {
    const sortedTeams = Object.entries(currentRoom.team_scores || {}).sort(([,a], [,b]) => (b as number) - (a as number))
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="text-center"><h1 className="text-2xl font-bold text-gray-900">Game Finished!</h1></div>
        <div className="card">
          <h2 className="text-xl font-semibold mb-6 text-center">Results</h2>
          {sortedTeams.map(([teamId, score], index) => (
            <div key={teamId} className={`p-4 rounded-lg border-2 mb-4 ${index===0?'border-yellow-400 bg-yellow-50':'border-gray-200'}`}>
              <div className="flex justify-between items-center"><h3 className="font-bold">Team {teamId}</h3><span className="text-2xl">{score} pts</span></div>
            </div>
          ))}
        </div>
        
        {/* Feedback Section */}
        <div className="card border-blue-200 bg-blue-50">
            <div className="flex items-center space-x-2 mb-4"><Sparkles className="w-5 h-5 text-blue-600" /><h3 className="font-semibold text-blue-900">AI Analysis</h3></div>
            {currentRoom.feedback ? (
                <div className="space-y-4">
                    <div className="bg-white p-4 rounded-lg"><p>{currentRoom.feedback.summary}</p></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-green-50 p-4 border-green-100 rounded">
                            <h4 className="font-bold text-green-900">Strengths</h4>
                            <ul className="list-disc pl-4 text-green-800 text-sm">{currentRoom.feedback.strengths?.map(s=><li key={s}>{s}</li>)}</ul>
                        </div>
                        <div className="bg-red-50 p-4 border-red-100 rounded">
                            <h4 className="font-bold text-red-900">Weak Points</h4>
                            <ul className="list-disc pl-4 text-red-800 text-sm">{currentRoom.feedback.weak_points?.map(s=><li key={s}>{s}</li>)}</ul>
                        </div>
                    </div>
                </div>
            ) : <div className="text-center py-8"><Loader className="w-8 h-8 animate-spin mx-auto text-blue-600"/><p>Generating feedback...</p></div>}
        </div>

        <div className="text-center space-x-4"><button onClick={leaveRoom} className="btn-primary">Leave</button>{isRoomCreator && <button onClick={()=>deleteRoom(currentRoom.id)} className="btn-secondary text-red-600">Delete</button>}</div>
      </div>
    )
  }

  // --- VIEW: IN PROGRESS (GAMEPLAY) ---
  if (currentRoom && currentRoom.room_status === 'in_progress') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">{currentRoom.name}</h1><p>Code: <span className="font-mono font-bold">{currentRoom.code}</span></p></div>
          <div className="flex space-x-2">
            <button onClick={leaveRoom} className="btn-secondary">Leave</button>
            <button onClick={() => { if(currentRoom) supabase.from('team_rooms').select('*').eq('id', currentRoom.id).single().then(({data}) => data && setCurrentRoom(data as ExtendedTeamRoom)) }} className="btn-secondary"><RotateCcw className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="card">
          <div className="flex flex-col sm:flex-row justify-between items-center">
            <div className="flex space-x-6 text-center">
              <div><div className="text-2xl font-bold text-primary-600">Team {currentRoom.current_turn_team_id}</div><div className="text-sm text-gray-600">{isStealMode ? <span className="text-orange-500 font-bold">STEAL!</span> : 'Current Turn'}</div></div>
              <div><div className="text-2xl font-bold">{currentRoom.current_question_index + 1}/{currentRoom.questions_per_team}</div><div className="text-sm text-gray-600">Round</div></div>
            </div>
            {timeRemaining > 0 ? (
              <div className="flex items-center space-x-2 mt-4 sm:mt-0">
                <Timer className={timeRemaining < 10 ? 'text-red-600' : 'text-primary-600'} />
                <span className={`text-2xl font-mono font-bold ${timeRemaining < 10 ? 'text-red-600' : 'text-primary-600'}`}>{formatTime(timeRemaining)}</span>
              </div>
            ) : <span className="text-red-600 font-bold mt-4 sm:mt-0">Time's Up!</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Question Area */}
          <div className="lg:col-span-2">
            <div className="card p-8">
              {currentQuestion ? (
                <>
                  <div className="mb-4">
                      <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 uppercase tracking-wider">
                        {currentQuestion.type === 'input' ? 'Numerical / Input' : currentQuestion.type.replace('_', ' ')}
                      </span>
                      {!isUserTurn && <div className="mt-2 text-center p-2 bg-gray-100 rounded text-sm text-gray-600">Waiting for opponents...</div>}
                  </div>

                  <h2 className="text-xl font-bold text-gray-900 mb-8">{currentQuestion.question}</h2>

                  {/* --- RENDER QUESTION TYPES --- */}
                  
                  {/* Type 1: Single Choice / Multiple Choice (Radio style) */}
                  {(currentQuestion.type === 'single_choice' || currentQuestion.type === 'multiple_choice') && currentQuestion.options && (
                    <div className="space-y-3">
                      {currentQuestion.options.map((option, index) => (
                        <button key={index} onClick={() => isUserTurn && !hasAnswered && setSelectedAnswer(index)} disabled={!isUserTurn || hasAnswered}
                          className={`w-full text-left p-4 border-2 rounded-xl transition-all ${
                            selectedAnswer === index 
                            ? 'border-primary-600 bg-primary-50 shadow-sm' 
                            : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                          } ${(!isUserTurn || hasAnswered) ? 'cursor-not-allowed opacity-80' : ''}`}>
                          <div className="flex justify-between items-center">
                            <div className="flex items-center">
                              <div className={`flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center mr-4 ${
                                 selectedAnswer === index ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 text-gray-500'
                              }`}>
                                {String.fromCharCode(65 + index)}
                              </div>
                              <span className={`font-medium ${selectedAnswer === index ? 'text-primary-900' : 'text-gray-700'}`}>{option}</span>
                            </div>
                            {/* Teammate Dots */}
                            <div className="flex space-x-1">{teamAnswers.filter(a => a.answer === index).map((_, i) => <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Type 2: Multi-Select (Checkboxes) */}
                  {currentQuestion.type === 'multi_choice' && currentQuestion.options && (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-500 font-medium mb-2 uppercase tracking-wide">Select all that apply:</p>
                      {currentQuestion.options.map((option, index) => {
                        const isSelected = (Array.isArray(selectedAnswer) ? selectedAnswer : []).includes(index);
                        return (
                          <button key={index} onClick={() => handleMultiChoiceSelect(index)} disabled={!isUserTurn || hasAnswered}
                            className={`w-full text-left p-4 border-2 rounded-xl transition-all ${
                                isSelected ? 'border-primary-600 bg-primary-50 shadow-sm' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                            } ${(!isUserTurn || hasAnswered) ? 'cursor-not-allowed opacity-80' : ''}`}>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center">
                                <div className={`mr-4 ${isSelected ? 'text-primary-600' : 'text-gray-300'}`}>
                                  {isSelected ? <CheckSquare className="w-6 h-6" /> : <Square className="w-6 h-6" />}
                                </div>
                                <span className={`font-medium ${isSelected ? 'text-primary-900' : 'text-gray-700'}`}>{option}</span>
                              </div>
                              {/* Teammate Dots */}
                              <div className="flex space-x-1">{teamAnswers.filter(a => Array.isArray(a.answer) && a.answer.includes(index)).map((_, i) => <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />)}</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {/* Type 3: Input / Numerical */}
                  {(currentQuestion.type === 'input' || currentQuestion.type === 'numerical') && (
                    <div className="mt-6">
                        <label className="block text-sm font-bold text-gray-700 mb-2">Enter your answer:</label>
                        <div className="relative rounded-md shadow-sm">
                            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                              <Type className="h-5 w-5 text-gray-400" />
                            </div>
                            <input 
                                type="text"
                                className="block w-full rounded-lg border-2 border-gray-300 pl-10 py-3 text-lg focus:border-primary-500 focus:ring-primary-500 transition-colors"
                                placeholder="e.g. 12.34 or Answer"
                                value={typeof selectedAnswer === 'string' ? selectedAnswer : ''}
                                onChange={(e) => isUserTurn && !hasAnswered && setSelectedAnswer(e.target.value)}
                                disabled={!isUserTurn || hasAnswered}
                            />
                        </div>
                        {/* Teammate Visuals for Input */}
                        {teamAnswers.length > 0 && (
                            <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                <p className="text-xs font-bold text-gray-500 uppercase mb-2">Teammates typed:</p>
                                <div className="flex flex-wrap gap-2">
                                    {teamAnswers.map((a, i) => (
                                        <span key={i} className="px-2 py-1 bg-white border border-gray-300 rounded text-sm font-mono text-gray-700 shadow-sm">
                                            {String(a.answer)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                  )}

                  {/* Submission & Status */}
                  <div className="mt-8 pt-6 border-t border-gray-100">
                      {isUserTurn ? (
                          <>
                            {hasAnswered ? (
                                <div className="flex items-center justify-center p-3 bg-green-50 text-green-700 rounded-lg border border-green-200">
                                    <UserCheck className="w-5 h-5 mr-2" />
                                    <span className="font-bold">Answer Submitted!</span>
                                    {!hasConsensus && <span className="ml-2 text-sm text-green-600 font-normal">Waiting for team...</span>}
                                </div>
                            ) : (
                                <button onClick={submitAnswer} disabled={selectedAnswer === null} className="w-full btn-primary py-4 text-lg">
                                    Submit Answer
                                </button>
                            )}
                          </>
                      ) : (
                        <div className="text-center text-gray-500 flex items-center justify-center">
                            <Clock className="w-5 h-5 mr-2" />
                            Opposing team is thinking...
                        </div>
                      )}
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-gray-500">
                    <Loader className="w-8 h-8 animate-spin mx-auto mb-4" />
                    <p>Loading question...</p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar / Scoreboard */}
          <div className="space-y-6">
             <div className="card bg-gray-900 text-white">
                 <h3 className="text-lg font-bold mb-4 flex items-center"><Trophy className="w-5 h-5 mr-2 text-yellow-400"/> Scoreboard</h3>
                 <div className="space-y-4">
                     {[1, 2].map(id => (
                         <div key={id} className={`flex justify-between items-center p-3 rounded-lg ${currentRoom.current_turn_team_id === id ? 'bg-white/20 ring-2 ring-yellow-400' : 'bg-white/10'}`}>
                             <span className="font-bold">Team {id}</span>
                             <span className="font-mono text-xl">{currentRoom.team_scores?.[id] || 0}</span>
                         </div>
                     ))}
                 </div>
             </div>
             
             {/* Teammates List */}
             <div className="card">
                 <h3 className="font-bold text-gray-700 mb-4">My Team</h3>
                 <div className="space-y-2">
                     {participants.filter(p => p.team_number === userParticipant?.team_number).map(p => (
                         <div key={p.id} className="flex items-center text-sm p-2 rounded hover:bg-gray-50">
                             <div className={`w-2 h-2 rounded-full mr-2 ${currentAnswers[p.user_id] ? 'bg-green-500' : 'bg-gray-300'}`} />
                             <span className={p.user_id === user?.id ? 'font-bold' : ''}>{p.user_email?.split('@')[0]}</span>
                             {currentAnswers[p.user_id] && <Check className="w-4 h-4 ml-auto text-green-600" />}
                         </div>
                     ))}
                 </div>
             </div>
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: HOME (NO ROOM) ---
  return (
    <div className="max-w-md mx-auto mt-10 px-4">
      <h1 className="text-4xl font-extrabold text-center text-gray-900 mb-8 tracking-tight">Team Quiz</h1>
      
      <div className="grid grid-cols-1 gap-4">
        <button onClick={() => setShowCreateRoom(true)} className="btn-primary py-4 text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition-all flex items-center justify-center">
          <Plus className="w-6 h-6 mr-2" /> Create Room
        </button>
        <button onClick={() => setShowJoinRoom(true)} className="btn-secondary py-4 text-lg border-2 hover:border-primary-500 flex items-center justify-center">
          <LogIn className="w-6 h-6 mr-2" /> Join Room
        </button>
      </div>

      {/* Existing Rooms List (Optional) */}
      {rooms.length > 0 && (
          <div className="mt-10">
              <h2 className="text-sm font-bold text-gray-500 uppercase mb-4 tracking-wider">Active Rooms</h2>
              <div className="space-y-3">
                  {rooms.map(room => (
                      <div key={room.id} className="card p-4 hover:shadow-md transition-shadow cursor-pointer border-l-4 border-primary-500" onClick={() => { setRoomCode(room.code); setShowJoinRoom(true); }}>
                          <div className="flex justify-between items-center">
                              <span className="font-bold text-lg">{room.name}</span>
                              <span className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{room.code}</span>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* --- MODALS --- */}
      
      {/* Create Room Modal */}
      {showCreateRoom && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up">
            <h2 className="text-2xl font-bold mb-6">Create New Room</h2>
            <input type="text" placeholder="Room Name" className="w-full border-2 border-gray-200 rounded-lg p-3 mb-6 focus:border-primary-500 focus:ring-primary-500 transition-colors" value={roomName} onChange={e => setRoomName(e.target.value)} />
            
            {/* Settings Toggle (Simplified) */}
            <div className="mb-6 space-y-4 border-t pt-4">
                <p className="text-sm font-bold text-gray-500 uppercase">Game Settings</p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Questions/Team</label>
                        <input type="number" value={roomSettings.questionsPerTeam} onChange={(e)=>setRoomSettings({...roomSettings, questionsPerTeam: Number(e.target.value)})} className="w-full border rounded p-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 block mb-1">Seconds/Question</label>
                        <input type="number" value={roomSettings.timePerQuestion} onChange={(e)=>setRoomSettings({...roomSettings, timePerQuestion: Number(e.target.value)})} className="w-full border rounded p-2 text-sm" />
                    </div>
                </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowCreateRoom(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createRoom} disabled={loading} className="btn-primary px-6">
                {loading ? <Loader className="w-5 h-5 animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Room Modal - UPDATED: Removed Team Selection UI */}
      {showJoinRoom && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-fade-in-up">
            <h2 className="text-2xl font-bold mb-6">Join Room</h2>
            
            <div className="mb-6">
                <label className="block text-sm font-bold text-gray-700 mb-2">Room Code</label>
                <input type="text" placeholder="ABCD12" className="w-full border-2 border-gray-200 rounded-lg p-3 text-center text-2xl font-mono uppercase tracking-widest focus:border-primary-500 focus:ring-primary-500" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} maxLength={6} />
            </div>

            <div className="flex justify-end space-x-3">
              <button onClick={() => setShowJoinRoom(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={joinRoom} disabled={loading || roomCode.length < 6} className="btn-primary px-6">
                {loading ? <Loader className="w-5 h-5 animate-spin" /> : 'Join & Select Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}