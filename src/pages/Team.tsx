import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, 
  Trophy, Loader, Clock, Play, Target, Trash2, Sparkles,
  Check, Square, CheckSquare, Type, Hash, CircleCheck
} from 'lucide-react'

// --- Interfaces ---

interface QuizQuestion {
  id: string
  type: 'single_choice' | 'multi_choice' | 'input'
  question: string
  options: string[] 
  correct_answer: string | number | number[] 
  explanation: string
  difficulty: string
}

interface GameQuestion extends QuizQuestion {
  owner_team_id?: number;
}

interface ExtendedTeamRoom extends TeamRoom {
  current_question: GameQuestion | null;
  feedback?: {
    summary?: string;
    weak_points?: string[];
    strengths?: string[];
    detailed_analysis?: string;
  } | null;
}

// --- Helpers (Defined outside to prevent ReferenceErrors) ---

const formatTime = (seconds: number) => {
  if (!seconds && seconds !== 0) return "0:00";
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const isAnswerCorrect = (userAns: any, correctAns: any, type: string) => {
  if (type === 'single_choice') return Number(userAns) === Number(correctAns);
  if (type === 'multi_choice') {
      // Sort both arrays and stringify to compare
      const u = Array.isArray(userAns) ? userAns.sort().toString() : '';
      const c = Array.isArray(correctAns) ? correctAns.sort().toString() : '';
      return u === c;
  }
  if (type === 'input') {
      return String(userAns).trim().toLowerCase() === String(correctAns).trim().toLowerCase();
  }
  return false;
}

export default function Team() {
  const { user } = useAuth()
  
  // State
  const [rooms, setRooms] = useState<ExtendedTeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<ExtendedTeamRoom | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  
  const [loading, setLoading] = useState(false)
  
  // Answer State (Flexible type)
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  
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
    if (saved) setSelectedDocuments(new Set(JSON.parse(saved)))
  }, [])

  useEffect(() => {
    if (currentRoom) {
      fetchParticipants()
      const unsubscribe = subscribeToRoomUpdates()
      return () => { if (unsubscribe) unsubscribe() }
    }
  }, [currentRoom?.id])

  // Game Engine (Host Consensus Check)
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
    const { data } = await supabase
      .from('team_rooms')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    setRooms((data as ExtendedTeamRoom[]) || [])
  }

  const fetchParticipants = async () => {
    if (!currentRoom) return
    const { data } = await supabase
      .from('room_participants')
      .select('*')
      .eq('room_id', currentRoom.id)
    setParticipants(data || [])
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
                
                // Merge big JSON objects if missing in payload
                const mergedRoom = { 
                    ...updatedRoom, 
                    team_questions: (updatedRoom.team_questions && Object.keys(updatedRoom.team_questions).length > 0) ? updatedRoom.team_questions : prevRoom.team_questions,
                    feedback: updatedRoom.feedback || prevRoom.feedback
                };

                // State change detection
                const prevQ = prevRoom.current_question;
                const nextQ = mergedRoom.current_question;
                
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
          team_scores: { "1": 0, "2": 0 },
          room_status: 'lobby'
        })
        .select().single()

      if (error) throw error

      await supabase.from('room_participants').insert({
          room_id: data.id,
          user_id: user.id,
          user_email: user.email || '',
          team_number: null 
      })

      setCurrentRoom(data as ExtendedTeamRoom)
      setShowCreateRoom(false)
      setRoomName('')
      fetchRooms()
    } catch (error) {
      console.error('Error creating room:', error)
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
        await supabase.from('room_participants').insert({
            room_id: room.id,
            user_id: user.id,
            user_email: user.email || '',
            team_number: null 
        })
      }

      setCurrentRoom(room as ExtendedTeamRoom)
      setShowJoinRoom(false)
      setRoomCode('')
    } catch (error: any) {
      alert(error.message)
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
      console.error(error)
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

  // --- Lobby Logic ---
  const handleJoinTeam = async (teamNum: number) => {
      if (!currentRoom || !user) return
      try {
          await supabase
            .from('room_participants')
            .update({ team_number: teamNum })
            .eq('room_id', currentRoom.id)
            .eq('user_id', user.id)
          
          setParticipants(prev => prev.map(p => p.user_id === user.id ? {...p, team_number: teamNum} : p))
      } catch (error) { console.error(error) }
  }

  // --- Game Logic ---

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    setLoading(true)
    try {
      const totalQuestions = 2 * currentRoom.questions_per_team
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { 
          count: totalQuestions,
          selectedDocuments: Array.from(selectedDocuments)
        }
      })
      if (error) throw error

      const teamQuestions: Record<string, QuizQuestion[]> = {}
      teamQuestions["1"] = data.questions.slice(0, currentRoom.questions_per_team)
      teamQuestions["2"] = data.questions.slice(currentRoom.questions_per_team, totalQuestions)
      const firstQ = { ...teamQuestions["1"][0], owner_team_id: 1 }

      await supabase.from('team_rooms').update({
          room_status: 'in_progress',
          team_questions: teamQuestions,
          team_scores: { "1": 0, "2": 0 },
          current_turn_team_id: 1,
          current_question_index: 0,
          current_question: firstQ,
          current_answers: {}
      }).eq('id', currentRoom.id)

    } catch (error: any) {
      alert(`Start failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    if (!currentRoom || !user || selectedAnswer === null) return
    if (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) return;
    if (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '') return;

    const currentAnswers = currentRoom.current_answers || {}
    currentAnswers[user.id] = {
      answer: selectedAnswer,
      user_email: user.email,
      team_number: participants.find(p => p.user_id === user.id)?.team_number
    }

    await supabase.from('team_rooms').update({ current_answers: currentAnswers }).eq('id', currentRoom.id)
  }

  const checkTeamConsensus = async () => {
    if (!currentRoom) return
    const teamMembers = participants.filter(p => p.team_number === currentRoom.current_turn_team_id)
    if (teamMembers.length === 0) return

    const answersMap = currentRoom.current_answers || {}
    const submissions = teamMembers
        .map(m => answersMap[m.user_id])
        .filter(a => a !== undefined)

    if (submissions.length === teamMembers.length && submissions.length > 0) {
        const firstAns = submissions[0].answer
        const allSame = submissions.every(sub => JSON.stringify(sub.answer) === JSON.stringify(firstAns))

        if (allSame) {
            setTimeout(() => advanceToNextQuestion(firstAns), 1000)
        }
    }
  }

  const advanceToNextQuestion = async (teamAnswer: any) => {
    if (!currentRoom || !currentRoom.team_questions) return

    const currentQ = currentRoom.current_question
    if (!currentQ) return

    const currentTeam = currentRoom.current_turn_team_id
    const isCorrect = isAnswerCorrect(teamAnswer, currentQ.correct_answer, currentQ.type)
    
    const originalOwner = currentQ.owner_team_id || currentTeam
    const isStealAttempt = currentTeam !== originalOwner
    
    let nextTeam = currentTeam
    let nextIndex = currentRoom.current_question_index
    let nextQuestion = null
    const teamScores = { ...currentRoom.team_scores }

    if (isCorrect) {
        teamScores[currentTeam.toString()] = (teamScores[currentTeam.toString()] || 0) + 1
        if (!isStealAttempt) {
             nextTeam = (currentTeam % 2) + 1
             if (currentTeam === 2) nextIndex++
        }
        // If steal correct -> keep turn
        const list = currentRoom.team_questions[nextTeam.toString()] || []
        nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null
    } else {
        if (!isStealAttempt) {
            nextTeam = (currentTeam % 2) + 1
            nextQuestion = currentQ // Steal chance
        } else {
            nextTeam = currentTeam // Back to owner
            const list = currentRoom.team_questions[nextTeam.toString()] || []
            nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null
        }
    }

    if (nextIndex >= currentRoom.questions_per_team) {
        await supabase.from('team_rooms').update({
            room_status: 'finished', 
            team_scores: teamScores
        }).eq('id', currentRoom.id)
        
        await supabase.functions.invoke('generate-feedback', {
            body: { scores: teamScores, questions: currentRoom.team_questions }
        }).then(({data}) => {
            if(data) supabase.from('team_rooms').update({ feedback: data }).eq('id', currentRoom.id)
        })
    } else {
        await supabase.from('team_rooms').update({
            current_turn_team_id: nextTeam,
            current_question_index: nextIndex,
            current_question: nextQuestion,
            current_answers: {},
            team_scores: teamScores
        }).eq('id', currentRoom.id)
    }
  }

  const handleTimeUp = async () => {
    setTimerActive(false)
    if (user?.id === currentRoom?.created_by) {
        await advanceToNextQuestion('PASS')
    }
  }

  // --- Render Helpers ---

  const handleMultiChoiceSelect = (idx: number) => {
      const current = (selectedAnswer as number[]) || []
      if (current.includes(idx)) setSelectedAnswer(current.filter(i => i !== idx))
      else setSelectedAnswer([...current, idx].sort())
  }

  const renderQuestionInput = (question: GameQuestion) => {
    const { type, options } = question

    if (type === 'single_choice') {
      return (
        <div className="space-y-3">
          {options.map((option, index) => {
             const isSelected = selectedAnswer === index
             return (
                <button key={index} onClick={() => setSelectedAnswer(index)} 
                  className={`w-full text-left p-3 border-2 rounded-lg flex items-center ${isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                   <div className={`w-6 h-6 rounded-full border mr-3 flex items-center justify-center ${isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-400 text-gray-500'}`}>
                      {String.fromCharCode(65 + index)}
                   </div>
                   <span>{option}</span>
                </button>
             )
          })}
        </div>
      )
    }

    if (type === 'multi_choice') {
      return (
        <div className="space-y-3">
          {options.map((option, index) => {
            const isSelected = (selectedAnswer as number[])?.includes(index)
            return (
              <button key={index} onClick={() => handleMultiChoiceSelect(index)}
                className={`w-full text-left p-3 border-2 rounded-lg flex items-center ${isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <div className={`mr-3 ${isSelected ? 'text-primary-600' : 'text-gray-300'}`}>
                    {isSelected ? <CheckSquare className="w-6 h-6"/> : <Square className="w-6 h-6"/>}
                </div>
                <span>{option}</span>
              </button>
            )
          })}
        </div>
      )
    }

    if (type === 'input') {
      return (
        <div className="mt-4">
          <div className="relative">
             <Type className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
             <input 
                type="text" 
                className="input-field pl-10 text-lg" 
                placeholder="Type your answer..." 
                value={selectedAnswer || ''}
                onChange={e => setSelectedAnswer(e.target.value)}
             />
          </div>
        </div>
      )
    }
  }

  // ==================== RENDER VIEWS ====================

  // 1. FINISHED
  if (currentRoom?.room_status === 'finished') {
      const sorted = Object.entries(currentRoom.team_scores).sort(([,a],[,b])=>b-a)
      const feedback = currentRoom.feedback

      return (
        <div className="max-w-4xl mx-auto space-y-6 px-4">
            <div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-2">Game Finished!</h1><p className="text-gray-600">{currentRoom.name}</p></div>
            
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">Final Results</h2>
              <div className="space-y-4">
                {sorted.map(([teamId, score], index) => {
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

            <div className="card border-blue-200 bg-blue-50">
                <div className="flex items-center space-x-2 mb-4">
                    <Sparkles className="w-5 h-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-blue-900">AI Analysis</h3>
                </div>
                
                {feedback ? (
                    <div className="space-y-4">
                        {feedback.summary && <div className="bg-white p-4 rounded-lg shadow-sm"><h4 className="font-medium mb-2">Summary</h4><p className="text-gray-700">{feedback.summary}</p></div>}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {feedback.strengths && <div className="bg-green-50 p-4 rounded-lg border border-green-100"><h4 className="font-medium text-green-900 mb-2">Strengths</h4><ul className="list-disc list-inside text-green-800 text-sm">{feedback.strengths.map((s,i)=><li key={i}>{s}</li>)}</ul></div>}
                            {feedback.weak_points && <div className="bg-red-50 p-4 rounded-lg border border-red-100"><h4 className="font-medium text-red-900 mb-2">Improvements</h4><ul className="list-disc list-inside text-red-800 text-sm">{feedback.weak_points.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8"><Loader className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" /><p className="text-blue-800">Generating feedback...</p></div>
                )}
            </div>
            <div className="mt-8 text-center flex justify-center space-x-4"><button onClick={leaveRoom} className="btn-primary">Leave Room</button></div>
        </div>
      )
  }

  // 2. IN PROGRESS
  if (currentRoom && currentRoom.room_status === 'in_progress') {
      const isUserTurn = participants.find(p => p.user_id === user?.id)?.team_number === currentRoom.current_turn_team_id
      const hasAnswered = user?.id && currentRoom.current_answers?.[user.id]
      const isStealMode = currentRoom.current_question?.owner_team_id !== currentRoom.current_turn_team_id

      return (
          <div className="max-w-5xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-4">
                  <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
                      <div className="flex items-center gap-2">
                          <Target className="text-primary-600"/>
                          <span className="font-bold text-lg">Round {currentRoom.current_question_index + 1}</span>
                      </div>
                      <div className={`flex items-center gap-2 font-mono text-xl font-bold ${timeRemaining<10?'text-red-600':'text-gray-700'}`}>
                          <Clock className="w-5 h-5"/> {formatTime(timeRemaining)}
                      </div>
                  </div>

                  <div className="card p-8">
                      <div className="mb-4 flex justify-between items-center">
                          <span className="badge badge-blue">Team {currentRoom.current_turn_team_id}'s Turn</span>
                          {isStealMode && <span className="badge badge-orange">STEAL!</span>}
                      </div>
                      
                      {currentRoom.current_question ? (
                          <>
                             <h2 className="text-xl font-bold mb-6">{currentRoom.current_question.question}</h2>
                             {renderQuestionInput(currentRoom.current_question)}
                             
                             {isUserTurn && !hasAnswered && (
                                 <button onClick={submitAnswer} className="btn-primary w-full mt-6 py-3">Submit Answer</button>
                             )}
                             {hasAnswered && <div className="mt-6 p-3 bg-green-50 text-green-700 rounded text-center font-bold">Answer Submitted</div>}
                             {!isUserTurn && <div className="mt-6 p-3 bg-gray-50 text-gray-500 rounded text-center">Waiting for opponent...</div>}
                          </>
                      ) : <Loader className="animate-spin mx-auto"/>}
                  </div>
              </div>

              <div className="space-y-4">
                   <div className="card">
                       <h3 className="font-bold mb-4">Scoreboard</h3>
                       {[1,2].map(t => (
                           <div key={t} className={`flex justify-between p-3 rounded-lg mb-2 ${currentRoom.current_turn_team_id===t ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                               <span className="font-medium">Team {t}</span>
                               <span className="font-bold text-primary-600">{currentRoom.team_scores[t]}</span>
                           </div>
                       ))}
                   </div>
                   <div className="card">
                       <h3 className="font-bold mb-4">Consensus</h3>
                       <div className="space-y-2">
                           {participants.filter(p => p.team_number === currentRoom.current_turn_team_id).map(p => (
                               <div key={p.id} className="flex justify-between items-center text-sm">
                                   <span className="truncate w-32">{p.user_email?.split('@')[0]}</span>
                                   {currentRoom.current_answers?.[p.user_id] ? <CircleCheck className="w-4 h-4 text-green-500"/> : <div className="w-4 h-4 rounded-full bg-gray-200"/>}
                               </div>
                           ))}
                       </div>
                   </div>
              </div>
          </div>
      )
  }

  // 3. LOBBY
  if (currentRoom && currentRoom.room_status === 'lobby') {
      const myTeam = participants.find(p => p.user_id === user?.id)?.team_number
      
      return (
          <div className="max-w-4xl mx-auto px-4">
              <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold">{currentRoom.name}</h1>
                  <p className="text-gray-500">Code: <span className="font-mono font-bold text-lg text-primary-600">{currentRoom.code}</span></p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                  {[1, 2].map(teamNum => (
                      <div key={teamNum} className={`card border-2 ${myTeam === teamNum ? 'border-primary-500 ring-1 ring-primary-500' : 'border-gray-200'}`}>
                          <h3 className="text-lg font-bold text-center mb-4">Team {teamNum}</h3>
                          <div className="space-y-2 mb-6 min-h-[100px]">
                              {participants.filter(p => p.team_number === teamNum).map(p => (
                                  <div key={p.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                                      <div className="w-6 h-6 bg-primary-100 rounded-full flex items-center justify-center text-xs text-primary-700 font-bold">
                                          {p.user_email?.charAt(0).toUpperCase()}
                                      </div>
                                      <span className="text-sm truncate">{p.user_email}</span>
                                  </div>
                              ))}
                          </div>
                          <button onClick={() => handleJoinTeam(teamNum)} disabled={myTeam === teamNum}
                             className={`w-full py-2 rounded-lg font-medium transition-colors ${myTeam === teamNum ? 'bg-green-100 text-green-700 cursor-default' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                              {myTeam === teamNum ? 'Joined ✓' : 'Join Team'}
                          </button>
                      </div>
                  ))}
              </div>

              {currentRoom.created_by === user?.id && (
                  <div className="text-center">
                      <button onClick={startGame} disabled={loading || participants.some(p => p.team_number === null)} className="btn-primary px-12 py-4 text-lg shadow-lg">
                          {loading ? <Loader className="animate-spin"/> : "Start Game"}
                      </button>
                      {participants.some(p => p.team_number === null) && <p className="text-sm text-red-500 mt-2">All players must pick a team to start.</p>}
                  </div>
              )}
              <div className="text-center mt-4"><button onClick={leaveRoom} className="text-gray-500 hover:underline">Leave Lobby</button></div>
          </div>
      )
  }

  // 4. MAIN MENU
  return (
    <div className="max-w-2xl mx-auto px-4">
       <h1 className="text-3xl font-bold text-center mb-8">Team Challenge</h1>
       
       <div className="grid gap-6">
           <div className="card p-6">
               <div className="flex items-center gap-3 mb-4">
                   <div className="p-2 bg-primary-100 rounded-lg"><Plus className="w-6 h-6 text-primary-600"/></div>
                   <h2 className="text-xl font-bold">Host a Game</h2>
               </div>
               {showCreateRoom ? (
                   <div className="space-y-4 animate-in slide-in-from-top-2">
                       <input className="input-field" placeholder="Room Name" value={roomName} onChange={e=>setRoomName(e.target.value)} />
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase">Questions / Team</label>
                               <div className="relative">
                                   <Hash className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/>
                                   <input type="number" className="input-field pl-9" value={roomSettings.questionsPerTeam} onChange={e=>setRoomSettings(s=>({...s, questionsPerTeam: parseInt(e.target.value)}))} min="1" />
                               </div>
                           </div>
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase">Time (sec)</label>
                               <div className="relative">
                                   <Clock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/>
                                   <input type="number" className="input-field pl-9" value={roomSettings.timePerQuestion} onChange={e=>setRoomSettings(s=>({...s, timePerQuestion: parseInt(e.target.value)}))} min="10" step="10" />
                               </div>
                           </div>
                       </div>
                       <div className="flex gap-3">
                           <button onClick={createRoom} disabled={loading} className="btn-primary flex-1">Create</button>
                           <button onClick={()=>setShowCreateRoom(false)} className="btn-secondary">Cancel</button>
                       </div>
                   </div>
               ) : <button onClick={()=>setShowCreateRoom(true)} className="btn-primary w-full">Create Room</button>}
           </div>

           <div className="card p-6">
               <div className="flex items-center gap-3 mb-4">
                   <div className="p-2 bg-green-100 rounded-lg"><LogIn className="w-6 h-6 text-green-600"/></div>
                   <h2 className="text-xl font-bold">Join a Game</h2>
               </div>
               {showJoinRoom ? (
                   <div className="space-y-4 animate-in slide-in-from-top-2">
                       <input className="input-field text-center font-mono text-lg tracking-widest uppercase" placeholder="CODE" maxLength={6} value={roomCode} onChange={e=>setRoomCode(e.target.value)} />
                       <div className="flex gap-3">
                           <button onClick={joinRoom} disabled={loading} className="btn-primary flex-1 bg-green-600 hover:bg-green-700">Join Lobby</button>
                           <button onClick={()=>setShowJoinRoom(false)} className="btn-secondary">Cancel</button>
                       </div>
                   </div>
               ) : <button onClick={()=>setShowJoinRoom(true)} className="btn-secondary w-full">Enter Code</button>}
           </div>
       </div>
    </div>
  )
}