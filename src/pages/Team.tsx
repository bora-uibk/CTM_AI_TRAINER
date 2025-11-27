import React, { useState, useEffect, useRef } from 'react'
import { supabase, TeamRoom, RoomParticipant } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, 
  Trophy, Loader, Clock, Target, Trash2, Sparkles,
  Check, Square, CheckSquare, Type, Hash, CircleCheck, AlertCircle, BookOpen
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

// --- HELPERS ---

const formatTime = (seconds: number | undefined | null) => {
  if (!seconds && seconds !== 0) return "0:00";
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const isAnswerCorrect = (userAns: any, correctAns: any, type: string) => {
  if (!userAns && userAns !== 0) return false;
  
  if (type === 'single_choice') return Number(userAns) === Number(correctAns);
  
  if (type === 'multi_choice') {
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
  
  // --- STATE ---
  const [rooms, setRooms] = useState<ExtendedTeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<ExtendedTeamRoom | null>(null)
  const [participants, setParticipants] = useState<RoomParticipant[]>([])
  
  const [showCreateRoom, setShowCreateRoom] = useState(false)
  const [showJoinRoom, setShowJoinRoom] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  
  const [loading, setLoading] = useState(false)
  
  // Answer State
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  const [timeRemaining, setTimeRemaining] = useState(0)
  
  // Documents State
  const [availableDocuments, setAvailableDocuments] = useState<any[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  
  // Settings
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60
  })

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // --- EFFECTS ---

  useEffect(() => {
    fetchRooms()
    fetchDocuments() // Load docs on mount
    
    // Backup poller
    const roomPoller = setInterval(fetchRooms, 5000);
    return () => clearInterval(roomPoller);
  }, [])

  // Room Subscription
  useEffect(() => {
    if (!currentRoom) return

    fetchParticipants()

    const channel = supabase
      .channel(`room-${currentRoom.id}`)
      // Listen for Participant Changes
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'room_participants', 
        filter: `room_id=eq.${currentRoom.id}` 
      }, () => {
          fetchParticipants();
      })
      // Listen for Game State
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'team_rooms', 
        filter: `id=eq.${currentRoom.id}` 
      }, (payload) => {
          const newRoom = payload.new as ExtendedTeamRoom
          
          setCurrentRoom(prev => {
              if (!prev) return newRoom;

              if (newRoom.room_status === 'in_progress') {
                  if (newRoom.current_turn_team_id !== prev.current_turn_team_id || 
                      newRoom.current_question_index !== prev.current_question_index) {
                      setTimeRemaining(newRoom.time_per_question)
                      setSelectedAnswer(null) 
                  }
              }

              return {
                  ...newRoom,
                  team_questions: (newRoom.team_questions && Object.keys(newRoom.team_questions).length > 0) 
                      ? newRoom.team_questions 
                      : prev.team_questions,
                  current_question: newRoom.current_question || prev.current_question
              };
          })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentRoom?.id])

  // Timer
  useEffect(() => {
    if (currentRoom?.room_status === 'in_progress') {
        timerRef.current = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 1) {
                    if (currentRoom.created_by === user?.id) handleTimeUp();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    } else {
        if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); }
  }, [currentRoom?.room_status, currentRoom?.current_turn_team_id, currentRoom?.current_question_index])

  // Host Consensus Check
  useEffect(() => {
    if (!currentRoom || !user || currentRoom.room_status !== 'in_progress') return
    if (currentRoom.created_by === user.id) {
        if (currentRoom.team_questions && Object.keys(currentRoom.team_questions).length > 0) {
            checkTeamConsensus()
        }
    }
  }, [currentRoom?.current_answers]) 


  // --- DATA HELPERS ---

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
    const { data, error } = await supabase
      .from('room_participants')
      .select('*')
      .eq('room_id', currentRoom.id)
    
    if (!error) setParticipants(data || [])
  }

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, content')
        .order('created_at', { ascending: false })

      if (!error) {
        const validDocs = (data || []).filter(doc => 
          doc.content && doc.content.length > 50
        )
        setAvailableDocuments(validDocs)
      }
    } catch (error) { console.error(error) }
  }

  const toggleDocumentSelection = (docId: string) => {
    const newSelected = new Set(selectedDocuments)
    if (newSelected.has(docId)) newSelected.delete(docId)
    else newSelected.add(docId)
    setSelectedDocuments(newSelected)
  }


  // --- ROOM ACTIONS ---

  const createRoom = async () => {
    if (!roomName.trim() || !user) return
    
    if (selectedDocuments.size === 0) {
        alert("Please select at least one document (e.g. Rulebook).")
        return
    }

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
          room_status: 'lobby',
          current_answers: {}
        })
        .select().single()

      if (error) throw error

      // Host joins as spectator
      await supabase.from('room_participants').insert({
          room_id: data.id,
          user_id: user.id,
          user_email: user.email || '',
          team_number: null 
      })

      setCurrentRoom(data as ExtendedTeamRoom)
      setShowCreateRoom(false)
      setRoomName('')
      fetchParticipants()
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
      fetchParticipants()
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
    } catch (error) { console.error(error) } 
    finally { setLoading(false) }
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

  // --- LOBBY LOGIC (FIXED TEAM JOINING) ---

  const handleJoinTeam = async (teamNum: number) => {
      if (!currentRoom || !user) return
      try {
          // 1. Database Update
          const { error } = await supabase
            .from('room_participants')
            .update({ team_number: teamNum })
            .eq('room_id', currentRoom.id)
            .eq('user_id', user.id)
          
          if (error) throw error

          // 2. Immediate State Update (don't wait for realtime)
          setParticipants(prev => 
              prev.map(p => p.user_id === user.id ? { ...p, team_number: teamNum } : p)
          )
          
          // 3. Force Fetch to verify
          await fetchParticipants()

      } catch (error: any) {
          console.error("Error joining team:", error)
          alert("Failed to join team. Please try again.")
      }
  }

  // --- GAME LOGIC ---

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    
    // Validation
    const t1Count = participants.filter(p => p.team_number === 1).length
    const t2Count = participants.filter(p => p.team_number === 2).length
    
    if (t1Count === 0 || t2Count === 0) {
        alert("Waiting for players... Both teams need at least 1 member.")
        return
    }

    setLoading(true)
    try {
      const totalQuestions = 2 * currentRoom.questions_per_team
      
      // Send selected documents from Host's state
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { 
          count: totalQuestions,
          selectedDocuments: Array.from(selectedDocuments) 
        }
      })

      if (error) throw error
      if (!data.questions || data.questions.length === 0) throw new Error("AI failed to generate questions.")

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
          current_answers: {},
          time_per_question: currentRoom.time_per_question
      }).eq('id', currentRoom.id)

    } catch (error: any) {
      alert(`Start failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const submitAnswer = async () => {
    if (!currentRoom || !user || selectedAnswer === null) return
    
    const participant = participants.find(p => p.user_id === user.id)
    if (!participant || !participant.team_number) return // Safety check

    const currentAnswers = currentRoom.current_answers || {}
    
    currentAnswers[user.id] = {
      answer: selectedAnswer,
      user_email: user.email,
      team_number: participant.team_number
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

    // Check if everyone on the active team has submitted
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
    const isCorrect = teamAnswer === 'PASS' ? false : isAnswerCorrect(teamAnswer, currentQ.correct_answer, currentQ.type)
    
    const originalOwner = currentQ.owner_team_id || currentTeam
    const isStealAttempt = currentTeam !== originalOwner
    
    let nextTeam = currentTeam
    let nextIndex = currentRoom.current_question_index
    let nextQuestion: GameQuestion | null = null
    const teamScores = { ...currentRoom.team_scores }

    if (isCorrect) {
        teamScores[currentTeam.toString()] = (teamScores[currentTeam.toString()] || 0) + 1
        
        if (!isStealAttempt) {
             // Normal correct -> Switch turn
             nextTeam = (currentTeam % 2) + 1
             // If Team 2 finished, increment round index
             if (currentTeam === 2) nextIndex++
        }
        
        // Load next question based on who is playing next
        const list = currentRoom.team_questions[nextTeam.toString()] || []
        nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null

    } else {
        // Wrong
        if (!isStealAttempt) {
            // Failed own -> Give opponent chance to steal SAME question
            nextTeam = (currentTeam % 2) + 1
            nextQuestion = currentQ 
        } else {
            // Failed steal -> Back to owner (currentTeam)
            nextTeam = currentTeam
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
    if (user?.id === currentRoom?.created_by) {
        await advanceToNextQuestion('PASS')
    }
  }

  // --- UI COMPONENTS ---

  const handleMultiChoiceSelect = (idx: number) => {
      const current = (selectedAnswer as number[]) || []
      if (current.includes(idx)) setSelectedAnswer(current.filter(i => i !== idx))
      else setSelectedAnswer([...current, idx].sort())
  }

  const renderQuestionInput = (question: GameQuestion) => {
    if (!question) return null;
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
          <p className="text-sm text-gray-500 mb-2">Select all that apply:</p>
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

  // ==================== MAIN RENDER ====================

  // 1. FINISHED
  if (currentRoom?.room_status === 'finished') {
      const sorted = Object.entries(currentRoom.team_scores).sort(([,a],[,b])=>b-a)
      const feedback = currentRoom.feedback
      return (
        <div className="max-w-4xl mx-auto space-y-6 px-4">
            <div className="text-center"><h1 className="text-2xl font-bold text-gray-900 mb-2">Game Finished!</h1><p className="text-gray-600">{currentRoom.name}</p></div>
            <div className="card">
              <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">Results</h2>
              <div className="space-y-4">
                {sorted.map(([teamId, score], index) => (
                    <div key={teamId} className={`p-4 rounded-lg border-2 ${index===0?'border-yellow-400 bg-yellow-50':'border-gray-200 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">{index===0 && <Crown className="w-5 h-5 text-yellow-500" />}<h3 className="font-semibold text-gray-900">Team {teamId}</h3></div>
                        <div className="text-2xl font-bold text-primary-600">{score} pts</div>
                      </div>
                    </div>
                ))}
              </div>
            </div>
            {/* Feedback UI */}
            <div className="card border-blue-200 bg-blue-50">
                <div className="flex items-center space-x-2 mb-4"><Sparkles className="w-5 h-5 text-blue-600" /><h3 className="text-lg font-semibold text-blue-900">AI Analysis</h3></div>
                {feedback ? (
                    <div className="space-y-4">
                        {feedback.summary && <p className="text-gray-700">{feedback.summary}</p>}
                        {/* Render detailed feedback here */}
                    </div>
                ) : <p className="text-blue-800 text-center">Generating...</p>}
            </div>
            <div className="mt-8 text-center"><button onClick={leaveRoom} className="btn-primary">Leave Room</button></div>
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
                      <div className="flex items-center gap-2"><Target className="text-primary-600"/><span className="font-bold text-lg">Round {currentRoom.current_question_index + 1}</span></div>
                      <div className={`flex items-center gap-2 font-mono text-xl font-bold ${timeRemaining<10?'text-red-600':'text-gray-700'}`}><Clock className="w-5 h-5"/> {formatTime(timeRemaining)}</div>
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
                             {isUserTurn && !hasAnswered && <button onClick={submitAnswer} className="btn-primary w-full mt-6 py-3">Submit Answer</button>}
                             {hasAnswered && <div className="mt-6 p-3 bg-green-50 text-green-700 rounded text-center font-bold">Answer Submitted</div>}
                             {!isUserTurn && <div className="mt-6 p-3 bg-gray-50 text-gray-500 rounded text-center">Waiting for opponent...</div>}
                          </>
                      ) : <Loader className="animate-spin mx-auto"/>}
                  </div>
              </div>
              <div className="space-y-4">
                   <div className="card"><h3 className="font-bold mb-4">Scoreboard</h3>{/* Scores */}</div>
                   <div className="card"><h3 className="font-bold mb-4">Consensus</h3>{/* Participants */}</div>
              </div>
          </div>
      )
  }

  // 3. LOBBY
  if (currentRoom && currentRoom.room_status === 'lobby') {
      // Derived logic to split participants
      const myTeam = participants.find(p => p.user_id === user?.id)?.team_number
      const team1Players = participants.filter(p => p.team_number === 1)
      const team2Players = participants.filter(p => p.team_number === 2)
      const spectators = participants.filter(p => p.team_number === null || p.team_number === undefined)
      
      return (
          <div className="max-w-4xl mx-auto px-4">
              <div className="text-center mb-8">
                  <h1 className="text-2xl font-bold">{currentRoom.name}</h1>
                  <p className="text-gray-500">Code: <span className="font-mono font-bold text-lg text-primary-600">{currentRoom.code}</span></p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                  {/* TEAM 1 */}
                  <div className={`card border-t-4 border-t-blue-500 ${myTeam===1 ? 'ring-2 ring-blue-500' : ''}`}>
                      <div className="text-center mb-6">
                          <h3 className="text-xl font-bold text-gray-900">Team 1</h3>
                          <p className="text-sm text-gray-500">{team1Players.length} Players</p>
                      </div>
                      <div className="space-y-2 mb-6 min-h-[100px]">
                          {team1Players.map(p => (
                              <div key={p.id} className="flex items-center gap-2 p-2 bg-blue-50 rounded">
                                  <div className="w-6 h-6 bg-blue-200 rounded-full flex items-center justify-center text-xs text-blue-700 font-bold">{p.user_email?.charAt(0)}</div>
                                  <span className="text-sm">{p.user_email}</span>
                              </div>
                          ))}
                      </div>
                      <button onClick={() => handleJoinTeam(1)} disabled={myTeam === 1} className="btn-primary w-full bg-blue-600 hover:bg-blue-700">Join Team 1</button>
                  </div>

                  {/* TEAM 2 */}
                  <div className={`card border-t-4 border-t-purple-500 ${myTeam===2 ? 'ring-2 ring-purple-500' : ''}`}>
                      <div className="text-center mb-6">
                          <h3 className="text-xl font-bold text-gray-900">Team 2</h3>
                          <p className="text-sm text-gray-500">{team2Players.length} Players</p>
                      </div>
                      <div className="space-y-2 mb-6 min-h-[100px]">
                          {team2Players.map(p => (
                              <div key={p.id} className="flex items-center gap-2 p-2 bg-purple-50 rounded">
                                  <div className="w-6 h-6 bg-purple-200 rounded-full flex items-center justify-center text-xs text-purple-700 font-bold">{p.user_email?.charAt(0)}</div>
                                  <span className="text-sm">{p.user_email}</span>
                              </div>
                          ))}
                      </div>
                      <button onClick={() => handleJoinTeam(2)} disabled={myTeam === 2} className="btn-primary w-full bg-purple-600 hover:bg-purple-700">Join Team 2</button>
                  </div>
              </div>

              {/* Waiting List */}
              {spectators.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4 text-center mb-8">
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Undecided Players</h4>
                      <div className="flex flex-wrap justify-center gap-2">
                          {spectators.map(p => (
                              <span key={p.id} className="px-3 py-1 bg-white border rounded-full text-sm text-gray-600">{p.user_email}</span>
                          ))}
                      </div>
                  </div>
              )}

              {currentRoom.created_by === user?.id && (
                  <div className="text-center">
                      <button onClick={startGame} disabled={loading || team1Players.length === 0 || team2Players.length === 0} className="btn-primary px-12 py-4 text-lg shadow-lg">
                          {loading ? <Loader className="animate-spin"/> : "Start Game"}
                      </button>
                  </div>
              )}
          </div>
      )
  }

  // 4. MAIN DASHBOARD (Create Room with Docs)
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
                   <div className="space-y-4 animate-in fade-in">
                       <input className="input-field" placeholder="Room Name" value={roomName} onChange={e=>setRoomName(e.target.value)} />
                       
                       {/* Document Selection Added Here */}
                       <div>
                           <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Knowledge Base</label>
                           <div className="border rounded-lg max-h-32 overflow-y-auto">
                               {availableDocuments.map(doc => (
                                   <div key={doc.id} onClick={()=>toggleDocumentSelection(doc.id)} className={`p-2 cursor-pointer text-sm flex items-center gap-2 ${selectedDocuments.has(doc.id) ? 'bg-primary-50' : ''}`}>
                                       <div className={`w-4 h-4 border rounded ${selectedDocuments.has(doc.id)?'bg-primary-600 border-primary-600':''}`}>{selectedDocuments.has(doc.id)&&<Check className="w-3 h-3 text-white"/>}</div>
                                       {doc.name}
                                   </div>
                               ))}
                           </div>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase">Questions/Team</label>
                               <input type="number" className="input-field" value={roomSettings.questionsPerTeam} onChange={e=>setRoomSettings(s=>({...s, questionsPerTeam: parseInt(e.target.value)}))} min="1"/>
                           </div>
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase">Time (sec)</label>
                               <input type="number" className="input-field" value={roomSettings.timePerQuestion} onChange={e=>setRoomSettings(s=>({...s, timePerQuestion: parseInt(e.target.value)}))} min="10"/>
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
                   <div className="space-y-4 animate-in fade-in">
                       <input className="input-field text-center font-mono text-2xl tracking-widest uppercase" placeholder="CODE" maxLength={6} value={roomCode} onChange={e=>setRoomCode(e.target.value)} />
                       <div className="flex gap-3">
                           <button onClick={joinRoom} disabled={loading} className="btn-primary flex-1 bg-green-600 hover:bg-green-700">Join Lobby</button>
                           <button onClick={()=>setShowJoinRoom(false)} className="btn-secondary">Cancel</button>
                       </div>
                   </div>
               ) : <button onClick={()=>setShowJoinRoom(true)} className="btn-secondary w-full">Enter Code</button>}
           </div>
       </div>
       
       {/* Active Rooms List */}
       {rooms.length > 0 && (
          <div className="mt-8">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center"><Trophy className="w-5 h-5 mr-2 text-yellow-500"/> Active Rooms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {rooms.map(room => (
                      <div key={room.id} className="bg-white border border-gray-200 rounded-xl p-4 relative hover:shadow-md">
                          <h3 className="font-bold text-gray-900 truncate pr-6">{room.name}</h3>
                          <div className="flex items-center text-xs text-gray-500 mt-2 gap-3">
                              <span className="flex items-center"><Users className="w-3 h-3 mr-1"/> {room.num_teams} Teams</span>
                              <span className="flex items-center"><Clock className="w-3 h-3 mr-1"/> {room.time_per_question}s</span>
                          </div>
                          <button onClick={() => { setRoomCode(room.code); setShowJoinRoom(true); }} className="btn-secondary w-full mt-3 text-sm">Join</button>
                          {user?.id === room.created_by && <button onClick={(e) => { e.stopPropagation(); deleteRoom(room.id); }} className="absolute top-4 right-4 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>}
                      </div>
                  ))}
              </div>
          </div>
       )}
    </div>
  )
}