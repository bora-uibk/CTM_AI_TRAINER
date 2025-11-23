import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, Trophy, Loader, Clock, Play, Settings, CircleCheck as CheckCircle, Circle as XCircle, Timer, Target, Award, Trash2, Sparkles } from 'lucide-react'

// Extend QuizQuestion interface locally to support the owner logic
interface GameQuestion extends QuizQuestion {
  owner_team_id?: number;
}

// Add feedback to TeamRoom interface
// NOTE: Ensure you have a 'feedback' column (type: jsonb) in your 'team_rooms' table
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
  const [rooms, setRooms] = useState<ExtendedTeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<ExtendedTeamRoom | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<string | number | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<number>(1)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  
  // Settings - Teams hardcoded to 2
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60
  })

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

  // --- GAME ENGINE (HOST ONLY) ---
  useEffect(() => {
    if (!currentRoom || !user || currentRoom.room_status !== 'in_progress') return

    // Only the Host checks for consensus to advance game
    if (currentRoom.created_by === user.id) {
        if (currentRoom.team_questions && Object.keys(currentRoom.team_questions).length > 0) {
            checkTeamConsensus()
        }
    }
  }, [currentRoom, participants])

  // --- TIMER EFFECT ---
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (timerActive && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            handleTimeUp() // Visual stop for everyone, Logic trigger for Host
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [timerActive, timeRemaining])

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
                // Preserve huge JSON objects if payload misses them
                const preservedQuestions = (updatedRoom.team_questions && Object.keys(updatedRoom.team_questions).length > 0)
                    ? updatedRoom.team_questions : prevRoom.team_questions;
                
                // Preserve feedback if it exists in memory but not payload
                const preservedFeedback = updatedRoom.feedback || prevRoom.feedback;

                const mergedRoom = { 
                    ...updatedRoom, 
                    team_questions: preservedQuestions,
                    feedback: preservedFeedback
                };

                // State change detection
                const prevQ = prevRoom.current_question as GameQuestion;
                const nextQ = mergedRoom.current_question as GameQuestion;
                
                // If question text changed OR ownership changed (steal happened), reset selections
                if (prevQ?.question !== nextQ?.question || mergedRoom.current_turn_team_id !== prevRoom.current_turn_team_id) {
                     setSelectedAnswer(null)
                }
                
                // Timer Logic: Sync timer when turn changes or question changes
                if (mergedRoom.room_status === 'in_progress') {
                   // If turn changed or question changed, reset timer
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
          num_teams: 2, // Hardcoded to 2
          questions_per_team: roomSettings.questionsPerTeam,
          time_per_question: roomSettings.timePerQuestion,
          current_turn_team_id: 1,
          current_question_index: 0,
          team_questions: {},
          team_scores: {},
          room_status: 'lobby',
          current_question: null,
          current_answers: {},
          feedback: null // Init feedback
        })
        .select().single()

      if (error) throw error
      await supabase.from('room_participants').insert({ room_id: data.id, user_id: user.id, user_email: user.email || '', team_number: 1 })
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
    if (!window.confirm("Are you sure you want to delete this room? This action cannot be undone.")) return
    setLoading(true)
    try {
      await supabase.from('team_rooms').delete().eq('id', roomId).eq('created_by', user.id)
      setRooms(prev => prev.filter(r => r.id !== roomId))
      if (currentRoom?.id === roomId) {
        setCurrentRoom(null)
        setParticipants([])
      }
    } catch (error) {
      console.error('Error deleting:', error)
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

      const { data: existing } = await supabase.from('room_participants').select('*').eq('room_id', room.id).eq('user_id', user.id).maybeSingle()

      if (!existing) {
        // Prevent joining team > 2
        if (selectedTeam > 2) { alert("Only 2 teams allowed"); setLoading(false); return; }
        await supabase.from('room_participants').insert({ room_id: room.id, user_id: user.id, user_email: user.email || '', team_number: selectedTeam })
      }
      setCurrentRoom(room)
      setShowJoinRoom(false)
      setRoomCode('')
    } catch (error) {
      alert('Failed to join room.')
    } finally {
      setLoading(false)
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
    } catch (error) { console.error(error) }
  }

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    setLoading(true)
    try {
      const totalQuestions = 2 * currentRoom.questions_per_team
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { count: totalQuestions, selectedDocuments: Array.from(selectedDocuments) }
      })

      if (error || !data?.questions) throw new Error('Quiz gen failed')

      const teamQuestions: Record<string, QuizQuestion[]> = {}
      const teamScores: Record<string, number> = { "1": 0, "2": 0 }
      
      // Assign questions
      teamQuestions["1"] = data.questions.slice(0, currentRoom.questions_per_team)
      teamQuestions["2"] = data.questions.slice(currentRoom.questions_per_team, totalQuestions)

      // Prepare first question with owner metadata
      const firstQ = { ...teamQuestions["1"][0], owner_team_id: 1 }

      await supabase.from('team_rooms').update({
          room_status: 'in_progress',
          team_questions: teamQuestions,
          team_scores: teamScores,
          current_turn_team_id: 1,
          current_question_index: 0,
          current_question: firstQ,
          current_answers: {},
          feedback: null // Reset feedback
        }).eq('id', currentRoom.id)

      // Local optimistic update
      setCurrentRoom(prev => prev ? {
          ...prev, room_status: 'in_progress', team_questions: teamQuestions, team_scores: teamScores,
          current_turn_team_id: 1, current_question_index: 0, current_question: firstQ, current_answers: {}, feedback: null
      } : null)

      setTimeRemaining(currentRoom.time_per_question)
      setTimerActive(true)
    } catch (error) {
      console.error(error)
      alert('Failed to start')
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
    } catch (error) { console.error(error) }
  }

  const checkTeamConsensus = async () => {
    if (!currentRoom) return
    const currentTeamMembers = participants.filter(p => p.team_number === currentRoom.current_turn_team_id)
    if (currentTeamMembers.length === 0) return

    const currentAnswers = currentRoom.current_answers || {}
    const teamAnswers = currentTeamMembers.map(m => currentAnswers[m.user_id]).filter(a => a !== undefined)

    if (teamAnswers.length === currentTeamMembers.length && teamAnswers.length > 0) {
        const firstAnswer = teamAnswers[0]?.answer
        const allSame = teamAnswers.every(a => a.answer === firstAnswer)
        if (allSame) {
            console.log('✅ Consensus detected by Host')
            setTimeout(() => { advanceToNextQuestion(firstAnswer) }, 1000)
        }
    }
  }

  // --- CORE GAME LOGIC ---
  const advanceToNextQuestion = async (teamAnswer: string | number) => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    if (!currentRoom.team_questions || Object.keys(currentRoom.team_questions).length === 0) {
      const { data } = await supabase.from('team_rooms').select('*').eq('id', currentRoom.id).single();
      if (data) setCurrentRoom(data as ExtendedTeamRoom);
      return;
    }

    try {
        const currentTeam = currentRoom.current_turn_team_id
        const currentQ = currentRoom.current_question as GameQuestion
        const isCorrect = teamAnswer === currentQ.correct_answer
        const originalOwner = currentQ.owner_team_id || currentTeam // Fallback to current if missing
        const isStealAttempt = currentTeam !== originalOwner

        let nextTeam = currentTeam
        let nextIndex = currentRoom.current_question_index
        let nextQuestion = null
        const teamScores = { ...currentRoom.team_scores }

        console.log(`📊 Result: ${isCorrect ? 'Correct' : 'Wrong'}, Stealing: ${isStealAttempt}`)

        if (isCorrect) {
            teamScores[currentTeam.toString()] = (teamScores[currentTeam.toString()] || 0) + 1
            
            if (isStealAttempt) {
                 nextTeam = currentTeam // T2 stays after stealing
            } else {
                 nextTeam = (currentTeam % 2) + 1
                 if (currentTeam === 2) nextIndex++
            }
            nextQuestion = getQuestionFromDeck(currentRoom.team_questions, nextTeam, nextIndex)

        } else {
            if (!isStealAttempt) {
                // Failed on OWN question -> Opponent steals
                nextTeam = (currentTeam % 2) + 1
                nextQuestion = currentQ // Keep SAME question
            } else {
                // Failed on STOLEN question -> Return to normal flow
                nextTeam = currentTeam 
                nextQuestion = getQuestionFromDeck(currentRoom.team_questions, nextTeam, nextIndex)
            }
        }

        // --- CHECK GAME OVER ---
        if (nextIndex >= currentRoom.questions_per_team) {
            // 1. Update to Finished (BUT KEEP IS_ACTIVE: TRUE)
            await supabase.from('team_rooms').update({
                room_status: 'finished', 
                // is_active: false,  <-- REMOVED THIS LINE TO FIX 403 ERROR
                team_scores: teamScores, 
                current_answers: {}, 
                updated_at: new Date().toISOString()
            }).eq('id', currentRoom.id)

            // 2. Generate AI Feedback (Async)
            console.log("🧠 Generating Feedback...")
            try {
                const { data: feedbackData, error: feedbackError } = await supabase.functions.invoke('generate-feedback', {
                    body: {
                        scores: teamScores,
                        // Send questions to AI to analyze content
                        questions: currentRoom.team_questions 
                    }
                })

                if (feedbackError) {
                    console.error("Feedback Gen Error:", feedbackError)
                } else if (feedbackData) {
                    console.log("✅ Feedback received, saving to DB...")
                    await supabase.from('team_rooms').update({
                        feedback: feedbackData
                    }).eq('id', currentRoom.id)
                }
            } catch (err) {
                console.error("Feedback invoke failed:", err)
            }

        } else {
            // Ensure next question has owner tag
            if (nextQuestion) {
                (nextQuestion as GameQuestion).owner_team_id = nextTeam
            }
            
            await supabase.from('team_rooms').update({
                current_turn_team_id: nextTeam,
                current_question_index: nextIndex,
                current_question: nextQuestion || null, 
                current_answers: {}, 
                team_scores: teamScores,
                updated_at: new Date().toISOString()
            }).eq('id', currentRoom.id)
        }
    } catch (error) { console.error(error) }
  }

  // Helper to safely get question
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

  // --- RENDER ---
  const isRoomCreator = currentRoom?.created_by === user?.id
  const currentQuestion = currentRoom?.current_question as GameQuestion | null
  const currentAnswers = currentRoom?.current_answers || {}
  const userParticipant = participants.find(p => p.user_id === user?.id)
  const isUserTurn = userParticipant?.team_number === currentRoom?.current_turn_team_id
  const hasAnswered = user?.id && currentAnswers[user.id]

  const isStealMode = currentQuestion && currentQuestion.owner_team_id && currentQuestion.owner_team_id !== currentRoom?.current_turn_team_id

  const currentTeamMembers = participants.filter(p => p.team_number === currentRoom?.current_turn_team_id)
  const teamAnswers = currentTeamMembers.map(m => currentAnswers[m.user_id]).filter(a => a !== undefined)
  const hasConsensus = teamAnswers.length === currentTeamMembers.length && teamAnswers.every(a => a.answer === teamAnswers[0]?.answer)

  if (currentRoom?.room_status === 'finished') {
    const sortedTeams = Object.entries(currentRoom.team_scores || {}).sort(([,a], [,b]) => (b as number) - (a as number))
    const feedback = currentRoom.feedback

    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-2">Game Finished!</h1><p className="text-gray-600">{currentRoom.name}</p></div>
        
        {/* SCOREBOARD */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">Final Results</h2>
          <div className="space-y-4">
            {sortedTeams.map(([teamId, score], index) => {
              const members = participants.filter(p => p.team_number === parseInt(teamId))
              return (
                <div key={teamId} className={`p-4 rounded-lg border-2 ${index===0?'border-yellow-400 bg-yellow-50':'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">{index===0 && <Crown className="w-5 h-5 text-yellow-500" />}<h3 className="font-semibold text-gray-900">Team {teamId}</h3></div>
                    <div className="text-2xl font-bold text-primary-600">{score} pts</div>
                  </div>
                  <div className="text-sm text-gray-600">Members: {members.map(m => m.user_email).join(', ')}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* AI FEEDBACK SECTION */}
        <div className="card border-blue-200 bg-blue-50">
            <div className="flex items-center space-x-2 mb-4">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-semibold text-blue-900">AI Analysis</h3>
            </div>
            
            {feedback ? (
                <div className="space-y-4">
                    {feedback.summary && (
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <h4 className="font-medium text-gray-900 mb-2">Summary</h4>
                            <p className="text-gray-700">{feedback.summary}</p>
                        </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {feedback.strengths && feedback.strengths.length > 0 && (
                            <div className="bg-green-50 p-4 rounded-lg border border-green-100">
                                <h4 className="font-medium text-green-900 mb-2">Strengths</h4>
                                <ul className="list-disc list-inside text-green-800 text-sm space-y-1">
                                    {feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                            </div>
                        )}
                         {feedback.weak_points && feedback.weak_points.length > 0 && (
                            <div className="bg-red-50 p-4 rounded-lg border border-red-100">
                                <h4 className="font-medium text-red-900 mb-2">Areas for Improvement</h4>
                                <ul className="list-disc list-inside text-red-800 text-sm space-y-1">
                                    {feedback.weak_points.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                    
                    {feedback.detailed_analysis && (
                        <div className="bg-white p-4 rounded-lg shadow-sm">
                            <h4 className="font-medium text-gray-900 mb-2">Detailed Insights</h4>
                            <p className="text-gray-700 text-sm whitespace-pre-wrap">{feedback.detailed_analysis}</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-8">
                    <Loader className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" />
                    <p className="text-blue-800 font-medium">Generating performance feedback...</p>
                    <p className="text-blue-600 text-sm">Analyzing answers and team coordination</p>
                </div>
            )}
        </div>

        <div className="mt-8 text-center flex justify-center space-x-4">
            <button onClick={leaveRoom} className="btn-primary">Leave Room</button>
            {isRoomCreator && <button onClick={() => deleteRoom(currentRoom.id)} className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"><Trash2 className="w-4 h-4 mr-2" /> Delete Room</button>}
        </div>
      </div>
    )
  }

  if (currentRoom && currentRoom.room_status === 'in_progress') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex items-center justify-between">
          <div><h1 className="text-2xl font-bold text-gray-900">{currentRoom.name}</h1><p className="text-gray-600">Room Code: <span className="font-mono font-bold">{currentRoom.code}</span></p></div>
          <div className="flex space-x-2">
            <button onClick={leaveRoom} className="btn-secondary">Leave</button>
            {isRoomCreator && <button onClick={() => deleteRoom(currentRoom.id)} className="p-2 border border-red-200 rounded-lg text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>}
            <button onClick={() => { if(currentRoom) supabase.from('team_rooms').select('*').eq('id', currentRoom.id).single().then(({data}) => data && setCurrentRoom(data as ExtendedTeamRoom)) }} className="btn-secondary"><RotateCcw className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600">Team {currentRoom.current_turn_team_id}</div>
                <div className="text-sm text-gray-600">{isStealMode ? <span className="text-orange-500 font-bold">STEAL CHANCE!</span> : 'Current Turn'}</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{currentRoom.current_question_index + 1}/{currentRoom.questions_per_team}</div>
                <div className="text-sm text-gray-600">Round</div>
              </div>
            </div>
            {timeRemaining > 0 && (
              <div className="flex items-center space-x-2">
                <Timer className={`w-5 h-5 ${timeRemaining < 10 ? 'text-danger-600' : 'text-primary-600'}`} />
                <span className={`text-2xl font-mono font-bold ${timeRemaining < 10 ? 'text-danger-600' : 'text-primary-600'}`}>{formatTime(timeRemaining)}</span>
              </div>
            )}
            {timeRemaining === 0 && <span className="text-red-600 font-bold">Time's Up! Waiting for host...</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="card">
              {currentQuestion ? (
                <div>
                  <div className="mb-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <Target className="w-5 h-5 text-primary-600" />
                      <span className="font-medium text-primary-600">
                        {isStealMode ? `Team ${currentRoom.current_turn_team_id} stealing from Team ${currentQuestion.owner_team_id}` : `Team ${currentRoom.current_turn_team_id}'s Question`}
                      </span>
                    </div>
                    {!isUserTurn && (
                      <div className="p-3 bg-gray-100 rounded-lg mb-4 text-center text-gray-600">
                        Waiting for Team {currentRoom.current_turn_team_id} to answer...
                      </div>
                    )}
                  </div>

                  <div className="mb-6">
                    <p className="text-lg text-gray-900 mb-4">{currentQuestion.question}</p>
                    {currentQuestion.type === 'multiple_choice' && currentQuestion.options && (
                      <div className="space-y-3">
                        {currentQuestion.options.map((option, index) => (
                          <button key={index} onClick={() => setSelectedAnswer(index)} disabled={!isUserTurn || hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all ${selectedAnswer===index?'border-primary-500 bg-primary-50':(!isUserTurn||hasAnswered)?'border-gray-200 bg-gray-50 cursor-not-allowed':'border-gray-200 hover:bg-gray-50'}`}>
                            <div className="flex justify-between"><span>{String.fromCharCode(65+index)}. {option}</span>
                            <div className="flex space-x-1">{teamAnswers.filter(a => a.answer === index).map((_, i) => <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />)}</div></div>
                          </button>
                        ))}
                      </div>
                    )}
                    {currentQuestion.type === 'true_false' && (
                      <div className="space-y-3">
                        {[true, false].map((value) => (
                          <button key={value.toString()} onClick={() => setSelectedAnswer(value)} disabled={!isUserTurn || hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all ${selectedAnswer===value?'border-primary-500 bg-primary-50':(!isUserTurn||hasAnswered)?'border-gray-200 bg-gray-50 cursor-not-allowed':'border-gray-200 hover:bg-gray-50'}`}>
                            <div className="flex justify-between"><span>{value ? 'True' : 'False'}</span>
                            <div className="flex space-x-1">{teamAnswers.filter(a => a.answer === value).map((_, i) => <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />)}</div></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {isUserTurn && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex justify-between"><span className="text-blue-700 font-medium">Consensus</span><span className="text-blue-600">{teamAnswers.length}/{currentTeamMembers.length} answered</span></div>
                        {hasConsensus && <div className="flex items-center mt-1"><CheckCircle className="w-4 h-4 text-success-600 mr-1"/><span className="text-success-700 text-sm">Consensus reached!</span></div>}
                    </div>
                  )}

                  {isUserTurn && !hasAnswered && selectedAnswer !== null && (
                    <button onClick={submitAnswer} className="btn-primary"><Send className="w-4 h-4 mr-2" /> Submit Answer</button>
                  )}
                  {hasAnswered && <div className="p-3 bg-success-50 border border-success-200 rounded-lg text-success-700 flex items-center"><UserCheck className="w-5 h-5 mr-2" /> Answer submitted!</div>}
                </div>
              ) : <div className="text-center py-12"><Trophy className="w-12 h-12 text-gray-400 mx-auto" /><h3 className="text-lg font-medium text-gray-900">Loading Question...</h3></div>}
            </div>
          </div>

          <div className="space-y-4">
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Scores</h3>
              <div className="space-y-3">
                {[1, 2].map(teamNum => {
                  const members = participants.filter(p => p.team_number === teamNum)
                  const score = currentRoom.team_scores[teamNum.toString()] || 0
                  const isTurn = teamNum === currentRoom.current_turn_team_id
                  return (
                    <div key={teamNum} className={`p-3 rounded-lg border-2 ${isTurn ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="flex justify-between mb-2">
                        <div className="flex items-center space-x-2">{isTurn && <Play className="w-4 h-4 text-primary-600" />}<span className="font-medium text-gray-900">Team {teamNum}</span></div>
                        <div className="text-lg font-bold text-primary-600">{score}</div>
                      </div>
                      <div className="text-xs text-gray-600">{members.length} members</div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Participants</h3>
              <div className="space-y-2">
                {participants.map(p => (
                  <div key={p.id} className="flex justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-2">
                        {p.user_id === currentRoom.created_by && <Crown className="w-4 h-4 text-yellow-500" />}
                        <span className="text-sm font-medium">{p.user_email}</span>
                        <span className="text-xs bg-primary-100 text-primary-700 px-2 rounded">Team {p.team_number}</span>
                    </div>
                    {currentQuestion && p.team_number === currentRoom.current_turn_team_id && (
                        currentAnswers[p.user_id] ? <UserCheck className="w-4 h-4 text-success-600" /> : <div className="w-2 h-2 bg-gray-400 rounded-full" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Lobby
  if (currentRoom && currentRoom.room_status === 'lobby') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex justify-between items-center">
            <div><h1 className="text-2xl font-bold text-gray-900">{currentRoom.name}</h1><p className="text-gray-600">Code: <span className="font-mono font-bold">{currentRoom.code}</span></p></div>
            <div className="flex space-x-2"><button onClick={leaveRoom} className="btn-secondary">Leave</button>{isRoomCreator && <button onClick={() => deleteRoom(currentRoom.id)} className="btn-secondary text-red-600 border-red-200"><Trash2 className="w-4 h-4" /> Delete</button>}</div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings</h2>
            <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Teams:</span><span className="font-medium">2 (Fixed)</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Questions/Team:</span><span className="font-medium">{currentRoom.questions_per_team}</span></div>
            </div>
            {isRoomCreator && <div className="mt-6"><button onClick={startGame} disabled={loading || participants.length < 2} className="btn-primary w-full">{loading ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 mr-2" />} Start Game</button></div>}
          </div>
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Teams</h2>
            <div className="space-y-4">
                {[1, 2].map(teamNum => (
                    <div key={teamNum} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between mb-2"><h3 className="font-medium">Team {teamNum}</h3><span className="text-sm text-gray-500">{participants.filter(p => p.team_number === teamNum).length} members</span></div>
                        <div className="space-y-1">{participants.filter(p => p.team_number === teamNum).map(m => <div key={m.id} className="text-sm text-gray-700">{m.user_email}</div>)}</div>
                    </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main Menu
  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4">
        <h1 className="text-2xl font-bold text-gray-900">Team Challenge</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card text-center">
                <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mx-auto mb-4"><Plus className="w-6 h-6 text-primary-600" /></div>
                <h2 className="text-lg font-semibold mb-2">Create Room</h2>
                {showCreateRoom ? (
                    <div className="space-y-4">
                        <input type="text" value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="Room Name" className="input-field" />
                        <div className="grid grid-cols-2 gap-2">
                             <div><label className="text-xs text-gray-600">Questions</label><<input
  type="number"
  value={roomSettings.questionsPerTeam}
  onChange={e => {
    const v = e.target.value;

    // allow empty string while typing
    setRoomSettings(p => ({
      ...p,
      questionsPerTeam: v === "" ? "" : parseInt(v)
    }));
  }}
  className="input-field text-sm"
/>
  </div>
                             <div><label className="text-xs text-gray-600">Time (s)</label><select value={roomSettings.timePerQuestion} onChange={e => setRoomSettings(p => ({...p, timePerQuestion: parseInt(e.target.value)}))} className="input-field text-sm">{[30,60,90,120].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
                        </div>
                        <div className="flex space-x-2"><button onClick={createRoom} disabled={!roomName.trim() || loading} className="btn-primary flex-1">Create</button><button onClick={() => setShowCreateRoom(false)} className="btn-secondary">Cancel</button></div>
                    </div>
                ) : <button onClick={() => setShowCreateRoom(true)} className="btn-primary">Create Room</button>}
            </div>
            <div className="card text-center">
                <div className="w-12 h-12 bg-success-100 rounded-lg flex items-center justify-center mx-auto mb-4"><LogIn className="w-6 h-6 text-success-600" /></div>
                <h2 className="text-lg font-semibold mb-2">Join Room</h2>
                {showJoinRoom ? (
                    <div className="space-y-4">
                        <input type="text" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} placeholder="CODE" className="input-field font-mono text-center" maxLength={6} />
                        <div className="flex space-x-2">{[1, 2].map(n => <button key={n} onClick={() => setSelectedTeam(n)} className={`flex-1 py-2 border-2 rounded ${selectedTeam===n?'border-primary-500 bg-primary-50 text-primary-700':'border-gray-200'}`}>Team {n}</button>)}</div>
                        <div className="flex space-x-2"><button onClick={joinRoom} disabled={!roomCode.trim() || loading} className="btn-primary flex-1">Join</button><button onClick={() => setShowJoinRoom(false)} className="btn-secondary">Cancel</button></div>
                    </div>
                ) : <button onClick={() => setShowJoinRoom(true)} className="btn-primary">Join Room</button>}
            </div>
        </div>
        {rooms.length > 0 && (
            <div className="card">
                <h2 className="text-lg font-semibold mb-4">Active Rooms</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rooms.map(room => (
                        <div key={room.id} className="p-4 border border-gray-200 rounded-lg relative hover:bg-gray-50">
                            {user?.id === room.created_by && <button onClick={e => {e.stopPropagation(); deleteRoom(room.id)}} className="absolute top-2 right-2 p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>}
                            <h3 className="font-medium truncate pr-6">{room.name}</h3>
                            <p className="text-sm text-gray-500 mb-2">{room.num_teams} Teams</p>
                            <button onClick={() => {setRoomCode(room.code); setShowJoinRoom(true)}} className="btn-secondary w-full text-sm">Join</button>
                        </div>
                    ))}
                </div>
            </div>
        )}
    </div>
  )
}