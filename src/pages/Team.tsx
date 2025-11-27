import React, { useState, useEffect, useRef } from 'react'
import { supabase, TeamRoom, RoomParticipant } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, 
  Trophy, Loader, Clock, Target, Trash2, Sparkles,
  Check, Square, CheckSquare, Type, Hash, CircleCheck, AlertCircle
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
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  
  // Settings
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60
  })

  // Refs for consistency in intervals/timeouts
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // --- EFFECTS ---

  // 1. Initial Load
  useEffect(() => {
    fetchRooms()
    const saved = localStorage.getItem('selectedDocuments')
    if (saved) setSelectedDocuments(new Set(JSON.parse(saved)))
    
    // Backup poller to ensure rooms list stays fresh
    const roomPoller = setInterval(fetchRooms, 5000);
    return () => clearInterval(roomPoller);
  }, [])

  // 2. Room Subscription (Participants & Game State)
  useEffect(() => {
    if (!currentRoom) return

    // Initial fetch
    fetchParticipants()

    const channel = supabase
      .channel(`room-${currentRoom.id}`)
      // Listen for Participant Changes (Join/Leave/Team Select)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'room_participants', 
        filter: `room_id=eq.${currentRoom.id}` 
      }, () => {
          console.log('👥 Participant change detected, refetching...');
          fetchParticipants();
      })
      // Listen for Game State Changes
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'team_rooms', 
        filter: `id=eq.${currentRoom.id}` 
      }, (payload) => {
          const newRoom = payload.new as ExtendedTeamRoom
          
          setCurrentRoom(prev => {
              if (!prev) return newRoom;

              // Detect Turn Change or Question Change to reset timer
              if (newRoom.room_status === 'in_progress') {
                  if (newRoom.current_turn_team_id !== prev.current_turn_team_id || 
                      newRoom.current_question_index !== prev.current_question_index) {
                      setTimeRemaining(newRoom.time_per_question)
                      setSelectedAnswer(null) // Reset local answer selection
                  }
              }

              // Preserve big JSON objects if Supabase didn't send them (optimization)
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

    return () => { 
        supabase.removeChannel(channel) 
    }
  }, [currentRoom?.id])

  // 3. Local Timer
  useEffect(() => {
    if (currentRoom?.room_status === 'in_progress') {
        timerRef.current = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 1) {
                    // Only host triggers "Time Up" action
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


  // 4. Host Logic: Consensus Checker
  useEffect(() => {
    if (!currentRoom || !user || currentRoom.room_status !== 'in_progress') return
    if (currentRoom.created_by === user.id) {
        // Only run check if we have questions loaded
        if (currentRoom.team_questions && Object.keys(currentRoom.team_questions).length > 0) {
            checkTeamConsensus()
        }
    }
  }, [currentRoom?.current_answers]) // Run specifically when answers change

  // --- DATA FETCHING ---

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
    
    if (error) console.error('Error fetching participants:', error)
    else {
        setParticipants(data || [])
    }
  }

  // --- ROOM ACTIONS ---

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
          room_status: 'lobby',
          current_answers: {}
        })
        .select().single()

      if (error) throw error

      // Host joins as spectator initially (null team)
      await supabase.from('room_participants').insert({
          room_id: data.id,
          user_id: user.id,
          user_email: user.email || '',
          team_number: null 
      })

      setCurrentRoom(data as ExtendedTeamRoom)
      setShowCreateRoom(false)
      setRoomName('')
      fetchParticipants() // Immediate fetch
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
            team_number: null // Join as spectator first
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
    if (!window.confirm("Are you sure you want to close this room?")) return
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

  // --- LOBBY ACTIONS ---

  const handleJoinTeam = async (teamNum: number) => {
      if (!currentRoom || !user) return
      try {
          await supabase
            .from('room_participants')
            .update({ team_number: teamNum })
            .eq('room_id', currentRoom.id)
            .eq('user_id', user.id)
          
          // Optimistic UI update for speed
          setParticipants(prev => prev.map(p => p.user_id === user.id ? {...p, team_number: teamNum} : p))
      } catch (error) { console.error(error) }
  }

  // --- GAME LOGIC ---

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    
    // Check if teams have players
    const t1Count = participants.filter(p => p.team_number === 1).length
    const t2Count = participants.filter(p => p.team_number === 2).length
    if (t1Count === 0 || t2Count === 0) {
        alert("Both teams need at least 1 player to start.");
        return;
    }

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
      if (!data.questions || data.questions.length === 0) throw new Error("AI failed to generate questions.")

      const teamQuestions: Record<string, QuizQuestion[]> = {}
      teamQuestions["1"] = data.questions.slice(0, currentRoom.questions_per_team)
      teamQuestions["2"] = data.questions.slice(currentRoom.questions_per_team, totalQuestions)
      
      // First question belongs to Team 1
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
    // Input validation
    if (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) return;
    if (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '') return;

    const currentAnswers = currentRoom.current_answers || {}
    // Save answer
    currentAnswers[user.id] = {
      answer: selectedAnswer,
      user_email: user.email,
      team_number: participants.find(p => p.user_id === user.id)?.team_number
    }

    await supabase
      .from('team_rooms')
      .update({ current_answers: currentAnswers })
      .eq('id', currentRoom.id)
  }

  // --- Host Logic: Advance Game ---
  const checkTeamConsensus = async () => {
    if (!currentRoom) return
    
    const turnTeam = currentRoom.current_turn_team_id
    const teamMembers = participants.filter(p => p.team_number === turnTeam)
    if (teamMembers.length === 0) return // Should not happen if start checks are valid

    const answersMap = currentRoom.current_answers || {}
    
    // Get answers from current team members only
    const submissions = teamMembers
        .map(m => answersMap[m.user_id])
        .filter(a => a !== undefined)

    // Check if everyone answered
    if (submissions.length === teamMembers.length && submissions.length > 0) {
        const firstAns = submissions[0].answer
        // Check if all answers are identical (JSON stringify handles arrays/objects)
        const allSame = submissions.every(sub => JSON.stringify(sub.answer) === JSON.stringify(firstAns))

        if (allSame) {
            // Artificial delay for UX
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
    
    // Determine Ownership and Steal Status
    const originalOwner = currentQ.owner_team_id || currentTeam
    const isStealAttempt = currentTeam !== originalOwner
    
    let nextTeam = currentTeam
    let nextIndex = currentRoom.current_question_index
    let nextQuestion: GameQuestion | null = null
    const teamScores = { ...currentRoom.team_scores }

    console.log(`📝 Answer Checked: ${isCorrect}. Steal? ${isStealAttempt}. Owner: ${originalOwner}`)

    if (isCorrect) {
        // Point for correct answer
        teamScores[currentTeam.toString()] = (teamScores[currentTeam.toString()] || 0) + 1
        
        if (isStealAttempt) {
            // Steal successful: Stealing team gets to KEEP the turn and answer their own next question
            // Turn stays with currentTeam (the stealer)
            nextTeam = currentTeam
            // BUT they need a NEW question (from their own deck)
            // Note: current_question_index is global relative to deck progression per team? 
            // Strategy: If T2 steals from T1, T2 answers T1's Q. Then T2 gets their own Q.
            const list = currentRoom.team_questions[nextTeam.toString()] || []
            nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null
        } else {
            // Normal correct: Pass turn to other team
            nextTeam = (currentTeam % 2) + 1
            // If Team 2 just finished their turn, we move to next index (Round complete)
            if (currentTeam === 2) nextIndex++
            
            const list = currentRoom.team_questions[nextTeam.toString()] || []
            nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null
        }
    } else {
        // Wrong Answer
        if (!isStealAttempt) {
            // Failed own question -> Opponent gets a chance to STEAL
            nextTeam = (currentTeam % 2) + 1
            nextQuestion = currentQ // Keep SAME question for steal
        } else {
            // Failed steal -> Turn goes back to Original Owner (who already missed it)
            // Effectively, the round for this question ends.
            // Turn goes to the original owner to start THEIR next question? 
            // No, standard flow: T1 wrong -> T2 steal wrong -> T2 gets their OWN question.
            nextTeam = currentTeam // The stealer (who just failed) keeps turn to answer their own Q?
            // Actually usually: T1 misses -> T2 tries -> T2 misses -> T2 starts their normal turn.
            
            // Let's assume turn passes to the stealer (who is now the active player for their own Q)
            nextTeam = currentTeam 
            const list = currentRoom.team_questions[nextTeam.toString()] || []
            nextQuestion = list[nextIndex] ? { ...list[nextIndex], owner_team_id: nextTeam } : null
        }
    }

    // Check End of Game
    if (nextIndex >= currentRoom.questions_per_team) {
        await supabase.from('team_rooms').update({
            room_status: 'finished', 
            team_scores: teamScores
        }).eq('id', currentRoom.id)
        
        // Trigger Feedback
        await supabase.functions.invoke('generate-feedback', {
            body: { scores: teamScores, questions: currentRoom.team_questions }
        }).then(({data}) => {
            if(data) supabase.from('team_rooms').update({ feedback: data }).eq('id', currentRoom.id)
        })
    } else {
        // Proceed
        await supabase.from('team_rooms').update({
            current_turn_team_id: nextTeam,
            current_question_index: nextIndex,
            current_question: nextQuestion,
            current_answers: {}, // Reset answers
            team_scores: teamScores
        }).eq('id', currentRoom.id)
    }
  }

  const handleTimeUp = async () => {
    if (user?.id === currentRoom?.created_by) {
        await advanceToNextQuestion('PASS')
    }
  }

  // --- RENDER HELPERS ---

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

  // ==================== RENDER VIEWS ====================

  // 1. FINISHED VIEW
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
            
            {/* AI Feedback Section */}
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
                        {feedback.detailed_analysis && <div className="bg-white p-4 rounded-lg shadow-sm"><h4 className="font-medium mb-2">Insights</h4><p className="text-sm text-gray-700 whitespace-pre-wrap">{feedback.detailed_analysis}</p></div>}
                    </div>
                ) : (
                    <div className="text-center py-8"><Loader className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-2" /><p className="text-blue-800">Generating feedback...</p></div>
                )}
            </div>
            <div className="mt-8 text-center flex justify-center space-x-4"><button onClick={leaveRoom} className="btn-primary">Leave Room</button></div>
        </div>
      )
  }

  // 2. IN PROGRESS VIEW
  if (currentRoom && currentRoom.room_status === 'in_progress') {
      const myParticipant = participants.find(p => p.user_id === user?.id)
      const myTeamId = myParticipant?.team_number
      
      // Correct Logic: It is your turn if your team matches the current turn team
      const isUserTurn = myTeamId === currentRoom.current_turn_team_id
      
      const hasAnswered = user?.id && currentRoom.current_answers?.[user.id]
      const isStealMode = currentRoom.current_question?.owner_team_id !== currentRoom.current_turn_team_id

      // Ensure current question exists before rendering
      const questionData = currentRoom.current_question

      return (
          <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Main Game Board */}
              <div className="lg:col-span-3 space-y-4">
                  {/* Header Bar */}
                  <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary-50 rounded text-primary-700">
                             <Target className="w-5 h-5"/>
                          </div>
                          <div>
                              <h2 className="font-bold text-lg">Round {currentRoom.current_question_index + 1}</h2>
                              <p className="text-xs text-gray-500 uppercase tracking-wide">Question {currentRoom.current_question_index + 1} of {currentRoom.questions_per_team}</p>
                          </div>
                      </div>
                      <div className={`flex items-center gap-2 font-mono text-2xl font-bold px-4 py-2 rounded-lg border ${timeRemaining<10?'text-red-600 border-red-100 bg-red-50':'text-gray-700 border-gray-200'}`}>
                          <Clock className="w-5 h-5"/> {formatTime(timeRemaining)}
                      </div>
                  </div>

                  {/* Question Card */}
                  <div className={`card p-8 min-h-[400px] relative ${isStealMode ? 'ring-4 ring-orange-300' : ''}`}>
                      {isStealMode && (
                          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-bold shadow-lg animate-bounce">
                             ⚠️ STEAL OPPORTUNITY
                          </div>
                      )}

                      <div className="mb-6 flex justify-between items-center">
                          <span className={`badge ${currentRoom.current_turn_team_id === 1 ? 'badge-blue' : 'badge-purple'}`}>
                            Team {currentRoom.current_turn_team_id}'s Turn
                          </span>
                          {isUserTurn ? (
                              <span className="text-sm font-bold text-green-600 flex items-center"><UserCheck className="w-4 h-4 mr-1"/> Your Turn</span>
                          ) : (
                              <span className="text-sm font-bold text-gray-400 flex items-center"><Loader className="w-4 h-4 mr-1 animate-spin"/> Opponent Thinking</span>
                          )}
                      </div>
                      
                      {questionData ? (
                          <>
                             <h2 className="text-2xl font-bold text-gray-900 mb-8 leading-relaxed">{questionData.question}</h2>
                             
                             {/* Pass question object specifically to render */}
                             {renderQuestionInput(questionData)}
                             
                             {isUserTurn && !hasAnswered && (
                                 <button 
                                    onClick={submitAnswer} 
                                    disabled={selectedAnswer === null || (typeof selectedAnswer==='string' && !selectedAnswer.trim())}
                                    className="btn-primary w-full mt-8 py-4 text-lg shadow-lg hover:shadow-xl transition-all"
                                 >
                                    Submit Answer
                                 </button>
                             )}

                             {hasAnswered && (
                                 <div className="mt-8 p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-center font-bold animate-in fade-in zoom-in">
                                     Answer Submitted! Waiting for teammates...
                                 </div>
                             )}

                             {!isUserTurn && (
                                 <div className="mt-8 p-4 bg-gray-50 border border-gray-200 text-gray-500 rounded-xl text-center">
                                     Please wait for Team {currentRoom.current_turn_team_id} to answer...
                                 </div>
                             )}
                          </>
                      ) : <div className="py-20 text-center"><Loader className="w-10 h-10 animate-spin mx-auto text-gray-400"/></div>}
                  </div>
              </div>

              {/* Sidebar: Info */}
              <div className="space-y-4">
                   {/* Scoreboard */}
                   <div className="card p-4">
                       <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Scoreboard</h3>
                       <div className="space-y-2">
                           {[1,2].map(t => (
                               <div key={t} className={`flex justify-between items-center p-3 rounded-lg border transition-all ${currentRoom.current_turn_team_id===t ? 'border-primary-500 bg-primary-50 scale-105 shadow-sm' : 'border-gray-200 bg-white'}`}>
                                   <div className="flex items-center gap-2">
                                       <div className={`w-2 h-8 rounded-full ${t===1?'bg-blue-500':'bg-purple-500'}`}/>
                                       <span className="font-bold text-gray-700">Team {t}</span>
                                   </div>
                                   <span className="text-xl font-bold text-gray-900">{currentRoom.team_scores[t]}</span>
                               </div>
                           ))}
                       </div>
                   </div>

                   {/* Team Status */}
                   <div className="card p-4">
                       <h3 className="text-xs font-bold text-gray-500 uppercase mb-3">Team Consensus</h3>
                       <div className="space-y-1">
                           {participants.filter(p => p.team_number === currentRoom.current_turn_team_id).map(p => (
                               <div key={p.id} className="flex justify-between items-center p-2 hover:bg-gray-50 rounded">
                                   <div className="flex items-center gap-2 overflow-hidden">
                                       <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                                           {p.user_email?.charAt(0).toUpperCase()}
                                       </div>
                                       <span className="text-sm text-gray-700 truncate max-w-[100px]">{p.user_email?.split('@')[0]}</span>
                                   </div>
                                   {currentRoom.current_answers?.[p.user_id] ? 
                                      <CircleCheck className="w-5 h-5 text-green-500 flex-shrink-0"/> : 
                                      <div className="w-5 h-5 rounded-full border-2 border-gray-200 flex-shrink-0"/>
                                   }
                               </div>
                           ))}
                       </div>
                   </div>
              </div>
          </div>
      )
  }

  // 3. LOBBY VIEW
  if (currentRoom && currentRoom.room_status === 'lobby') {
      const myTeam = participants.find(p => p.user_id === user?.id)?.team_number
      const spectators = participants.filter(p => p.team_number === null)
      
      return (
          <div className="max-w-5xl mx-auto px-4">
              <div className="text-center mb-12">
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">{currentRoom.name}</h1>
                  <div className="inline-flex items-center gap-2 bg-white px-6 py-2 rounded-full shadow-sm border border-gray-200">
                      <span className="text-gray-500 uppercase text-xs font-bold tracking-wider">Room Code</span>
                      <span className="font-mono text-xl font-bold text-primary-600 tracking-widest">{currentRoom.code}</span>
                  </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                  {/* Team 1 Panel */}
                  <div className={`card border-t-4 border-t-blue-500 ${myTeam===1 ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}>
                      <div className="text-center mb-6">
                          <h3 className="text-xl font-bold text-gray-900">Team 1</h3>
                          <p className="text-sm text-gray-500">{participants.filter(p=>p.team_number===1).length} Players</p>
                      </div>
                      <div className="space-y-2 mb-6 min-h-[150px]">
                          {participants.filter(p => p.team_number === 1).map(p => (
                              <div key={p.id} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                  <div className="w-8 h-8 bg-blue-200 rounded-full flex items-center justify-center text-blue-700 font-bold">
                                      {p.user_email?.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="font-medium text-gray-700">{p.user_email}</span>
                                  {p.user_id === currentRoom.created_by && <Crown className="w-4 h-4 text-yellow-500 ml-auto"/>}
                              </div>
                          ))}
                      </div>
                      <button 
                         onClick={() => handleJoinTeam(1)}
                         disabled={myTeam === 1}
                         className={`w-full py-3 rounded-lg font-bold transition-all ${
                             myTeam === 1 
                             ? 'bg-blue-100 text-blue-700 cursor-default'
                             : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg'
                         }`}
                      >
                          {myTeam === 1 ? 'Joined Team 1' : 'Join Team 1'}
                      </button>
                  </div>

                  {/* Team 2 Panel */}
                  <div className={`card border-t-4 border-t-purple-500 ${myTeam===2 ? 'ring-2 ring-purple-500 ring-offset-2' : ''}`}>
                      <div className="text-center mb-6">
                          <h3 className="text-xl font-bold text-gray-900">Team 2</h3>
                          <p className="text-sm text-gray-500">{participants.filter(p=>p.team_number===2).length} Players</p>
                      </div>
                      <div className="space-y-2 mb-6 min-h-[150px]">
                          {participants.filter(p => p.team_number === 2).map(p => (
                              <div key={p.id} className="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                                  <div className="w-8 h-8 bg-purple-200 rounded-full flex items-center justify-center text-purple-700 font-bold">
                                      {p.user_email?.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="font-medium text-gray-700">{p.user_email}</span>
                              </div>
                          ))}
                      </div>
                      <button 
                         onClick={() => handleJoinTeam(2)}
                         disabled={myTeam === 2}
                         className={`w-full py-3 rounded-lg font-bold transition-all ${
                             myTeam === 2 
                             ? 'bg-purple-100 text-purple-700 cursor-default'
                             : 'bg-purple-600 text-white hover:bg-purple-700 shadow-md hover:shadow-lg'
                         }`}
                      >
                          {myTeam === 2 ? 'Joined Team 2' : 'Join Team 2'}
                      </button>
                  </div>
              </div>

              {/* Waiting Area */}
              {spectators.length > 0 && (
                  <div className="max-w-2xl mx-auto mb-8 bg-gray-50 rounded-xl p-4 text-center border border-gray-200">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">In Lobby (Waiting for Team Selection)</h4>
                      <div className="flex flex-wrap justify-center gap-2">
                          {spectators.map(p => (
                              <span key={p.id} className="px-3 py-1 bg-white border border-gray-300 rounded-full text-sm text-gray-600 flex items-center">
                                  <div className="w-2 h-2 bg-gray-400 rounded-full mr-2"/>
                                  {p.user_email}
                              </span>
                          ))}
                      </div>
                  </div>
              )}

              {/* Host Controls */}
              {currentRoom.created_by === user?.id && (
                  <div className="text-center space-y-4">
                      <button 
                        onClick={startGame} 
                        disabled={loading || participants.some(p => p.team_number === null)}
                        className="btn-primary px-16 py-4 text-xl shadow-xl hover:scale-105 transition-transform"
                      >
                          {loading ? <Loader className="animate-spin w-6 h-6"/> : "START GAME"}
                      </button>
                      {participants.some(p => p.team_number === null) && (
                          <div className="flex items-center justify-center text-orange-600 text-sm font-medium bg-orange-50 inline-block px-4 py-2 rounded-lg">
                              <AlertCircle className="w-4 h-4 mr-2"/>
                              Wait for all players to select a team
                          </div>
                      )}
                  </div>
              )}
              <div className="text-center mt-8"><button onClick={leaveRoom} className="text-gray-500 hover:text-gray-800 underline text-sm">Leave Lobby</button></div>
          </div>
      )
  }

  // 4. MAIN DASHBOARD
  return (
    <div className="max-w-2xl mx-auto px-4">
       <h1 className="text-3xl font-bold text-center mb-8">Team Challenge</h1>
       
       <div className="grid gap-6 mb-8">
           {/* Create */}
           <div className="card p-6 hover:shadow-md transition-shadow">
               <div className="flex items-center gap-3 mb-4">
                   <div className="p-2 bg-primary-100 rounded-lg"><Plus className="w-6 h-6 text-primary-600"/></div>
                   <h2 className="text-xl font-bold">Host a Game</h2>
               </div>
               {showCreateRoom ? (
                   <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                       <input className="input-field" placeholder="Room Name" value={roomName} onChange={e=>setRoomName(e.target.value)} />
                       <div className="grid grid-cols-2 gap-4">
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Questions/Team</label>
                               <input type="number" className="input-field" value={roomSettings.questionsPerTeam} onChange={e=>setRoomSettings(s=>({...s, questionsPerTeam: parseInt(e.target.value)||1}))} min="1"/>
                           </div>
                           <div>
                               <label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Time (sec)</label>
                               <input type="number" className="input-field" value={roomSettings.timePerQuestion} onChange={e=>setRoomSettings(s=>({...s, timePerQuestion: parseInt(e.target.value)||10}))} min="10" step="5"/>
                           </div>
                       </div>
                       <div className="flex gap-3 pt-2">
                           <button onClick={createRoom} disabled={loading} className="btn-primary flex-1">Create Room</button>
                           <button onClick={()=>setShowCreateRoom(false)} className="btn-secondary">Cancel</button>
                       </div>
                   </div>
               ) : <button onClick={()=>setShowCreateRoom(true)} className="btn-primary w-full py-3">Create New Room</button>}
           </div>

           {/* Join */}
           <div className="card p-6 hover:shadow-md transition-shadow">
               <div className="flex items-center gap-3 mb-4">
                   <div className="p-2 bg-green-100 rounded-lg"><LogIn className="w-6 h-6 text-green-600"/></div>
                   <h2 className="text-xl font-bold">Join a Game</h2>
               </div>
               {showJoinRoom ? (
                   <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                       <input className="input-field text-center font-mono text-2xl tracking-widest uppercase" placeholder="CODE" maxLength={6} value={roomCode} onChange={e=>setRoomCode(e.target.value)} />
                       <div className="flex gap-3 pt-2">
                           <button onClick={joinRoom} disabled={loading} className="btn-primary flex-1 bg-green-600 hover:bg-green-700">Enter Lobby</button>
                           <button onClick={()=>setShowJoinRoom(false)} className="btn-secondary">Cancel</button>
                       </div>
                   </div>
               ) : <button onClick={()=>setShowJoinRoom(true)} className="btn-secondary w-full py-3">Enter Code</button>}
           </div>
       </div>

       {/* Active Rooms List */}
       {rooms.length > 0 && (
          <div className="mt-8">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                <Trophy className="w-5 h-5 mr-2 text-yellow-500"/> Active Public Rooms
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {rooms.map(room => (
                      <div key={room.id} className="group bg-white border border-gray-200 rounded-xl p-4 hover:border-primary-300 hover:shadow-md transition-all relative cursor-pointer" onClick={() => { setRoomCode(room.code); setShowJoinRoom(true); }}>
                          <div className="flex justify-between items-start mb-2">
                              <h3 className="font-bold text-gray-900 truncate pr-6">{room.name}</h3>
                              {user?.id === room.created_by && (
                                  <button onClick={(e) => { e.stopPropagation(); deleteRoom(room.id); }} className="text-gray-400 hover:text-red-600 p-1 rounded-full hover:bg-red-50 transition-colors">
                                      <Trash2 className="w-4 h-4"/>
                                  </button>
                              )}
                          </div>
                          <div className="flex items-center text-xs text-gray-500 gap-3">
                              <span className="flex items-center bg-gray-100 px-2 py-1 rounded"><Users className="w-3 h-3 mr-1"/> {room.num_teams} Teams</span>
                              <span className="flex items-center bg-gray-100 px-2 py-1 rounded"><Clock className="w-3 h-3 mr-1"/> {room.time_per_question}s</span>
                          </div>
                          <div className="mt-3 text-center">
                              <span className="text-primary-600 font-medium text-sm group-hover:underline">Join Now &rarr;</span>
                          </div>
                      </div>
                  ))}
              </div>
          </div>
       )}
    </div>
  )
}