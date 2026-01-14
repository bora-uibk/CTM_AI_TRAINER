import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Users, Plus, LogIn, Crown, UserCheck, Send, RotateCcw, Trophy, Loader, Clock, Play, Settings, CircleCheck as CheckCircle, Circle as XCircle, Timer, Target, Award, Trash2, Sparkles, SquareCheck as CheckSquare, Square, Type, Check, Brain, Database, ListFilter as Filter, BookOpen, FileText, Hash } from 'lucide-react'

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
  
  // Team selection state
  const [showTeamSelection, setShowTeamSelection] = useState(false)
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null)
  
  // Game State
  // selectedAnswer can be: index (number), indices (number[]), or text (string)
  const [selectedAnswer, setSelectedAnswer] = useState<string | number | number[] | null>(null)
  const [selectedTeam, setSelectedTeam] = useState<number>(1)
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [timerActive, setTimerActive] = useState(false)
  
  // Quiz Creation State (from Quiz.tsx)
  const [quizMode, setQuizMode] = useState<'official' | 'ai'>('official')
  const [generating, setGenerating] = useState(false)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [availableDocuments, setAvailableDocuments] = useState<any[]>([])

  // Settings
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60,
    // New Filters for Official Mode
    yearFilter: 'all',
    sourceFilter: 'all'
  })

  // --- Effects ---
  useEffect(() => {
    fetchRooms()
    fetchDocuments()
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
  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      
      const validDocs = (data || []).filter(doc => 
        doc.content && 
        !doc.content.startsWith('[PDF Document:') && 
        doc.content.length > 100
      )
      setAvailableDocuments(validDocs)
    } catch (error) {
      console.error('Error fetching documents:', error)
    }
  }

  const toggleDocumentSelection = (docId: string) => {
    const newSelected = new Set(selectedDocuments)
    if (newSelected.has(docId)) {
      newSelected.delete(docId)
    } else {
      newSelected.add(docId)
    }
    setSelectedDocuments(newSelected)
    localStorage.setItem('selectedDocuments', JSON.stringify(Array.from(newSelected)))
  }

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

      // Ensure the room state reflects the correct settings
      const roomWithSettings = {
        ...data,
        questions_per_team: roomSettings.questionsPerTeam,
        time_per_question: roomSettings.timePerQuestion
      }

      await supabase.from('room_participants').insert({
        room_id: data.id,
        user_id: user.id,
        user_email: user.email || '',
        team_number: 1
      })

      setCurrentRoom(roomWithSettings)
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
        // Show team selection modal instead of using pre-selected team
        setPendingRoomId(room.id)
        setShowTeamSelection(true)
        setLoading(false)
        return
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

  const confirmTeamSelection = async (teamNumber: number) => {
    if (!pendingRoomId || !user) return
    setLoading(true)
    try {
      await supabase.from('room_participants').insert({
        room_id: pendingRoomId,
        user_id: user.id,
        user_email: user.email || '',
        team_number: teamNumber
      })

      const { data: room } = await supabase
        .from('team_rooms')
        .select('*')
        .eq('id', pendingRoomId)
        .single()

      setCurrentRoom(room)
      setShowJoinRoom(false)
      setShowTeamSelection(false)
      setPendingRoomId(null)
      setRoomCode('')
    } catch (error) {
      console.error('Error joining room:', error)
      alert('Failed to join room')
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
    } catch (error) {
      console.error(error)
    }
  }

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return
    setLoading(true)
    
    // Debug: Log the current room settings
    console.log('🔍 Debug - currentRoom.questions_per_team:', currentRoom.questions_per_team)
    console.log('🔍 Debug - roomSettings.questionsPerTeam:', roomSettings.questionsPerTeam)
    
    try {
      let allQuestions: any[] = []

      if (quizMode === 'ai') {
        if (selectedDocuments.size === 0) {
          alert("Please select at least one document for AI context.")
          setLoading(false)
          return
        }
        
        // Use roomSettings directly to ensure we get the user's selection
        const totalQuestions = 2 * roomSettings.questionsPerTeam
        const { data, error } = await supabase.functions.invoke('generate-quiz', {
          body: { 
            count: totalQuestions, 
            selectedDocuments: Array.from(selectedDocuments) 
          }
        })
        if (error) throw error
        allQuestions = data.questions || []
      } else {
        // Official Mode - Query question bank
        let query = supabase.from('question_bank').select('*')
        
        if (roomSettings.yearFilter !== 'all') {
          query = query.eq('year', parseInt(roomSettings.yearFilter))
        }
        if (roomSettings.sourceFilter !== 'all') {
          query = query.eq('source_event', roomSettings.sourceFilter)
        }

        const { data, error } = await query.limit(100) // Get more for shuffling
        if (error) throw error
        
        if (!data || data.length === 0) {
          alert("No questions found matching these filters.")
          setLoading(false)
          return
        }

        // Shuffle and slice to get the required number
        // Use roomSettings directly to ensure we get the user's selection
        const totalQuestions = 2 * roomSettings.questionsPerTeam
        const shuffledData = data
          .sort(() => 0.5 - Math.random())
          .slice(0, totalQuestions)

        // Convert to our format
        allQuestions = shuffledData.map((q: any) => {
          let rawOptions = q.options
          if (typeof rawOptions === 'string') {
            try { rawOptions = JSON.parse(rawOptions) } catch(e) {}
          }
          
          const opts = Array.isArray(rawOptions) ? rawOptions.map((o: any) => o.text) : []

          // Normalize type
          let normalizedType = 'input'
          if (q.type === 'single-choice' || q.type === 'single_choice') normalizedType = 'single_choice'
          else if (q.type === 'multi-choice' || q.type === 'multi_choice') normalizedType = 'multi_choice'
          else if (q.type === 'input' || q.type === 'input-range') normalizedType = 'input'

          // Calculate correct answer
          let correctVal: any = null
          if (normalizedType === 'single_choice') {
            correctVal = Array.isArray(rawOptions) 
              ? rawOptions.findIndex((o: any) => o.is_correct == true) 
              : 0
            if (correctVal === -1) correctVal = 0
          } else if (normalizedType === 'multi_choice') {
            correctVal = Array.isArray(rawOptions) 
              ? rawOptions.map((o: any, idx: number) => o.is_correct ? idx : -1).filter((i:number) => i !== -1)
              : []
          } else {
            const correctObj = Array.isArray(rawOptions) ? rawOptions.find((o: any) => o.is_correct === true) : null
            correctVal = correctObj ? correctObj.text : ""
          }

          // Handle images
          let imgPath = null
          let rawImages = q.images
          if (typeof rawImages === 'string') {
            try { rawImages = JSON.parse(rawImages) } catch(e) {}
          }
          if (Array.isArray(rawImages) && rawImages.length > 0) {
            imgPath = rawImages[0].path
          }

          return {
            id: q.id,
            type: normalizedType,
            question: q.question_text,
            options: opts,
            correct_answer: correctVal,
            explanation: q.explanation || "See official solution.",
            difficulty: 'Hard',
            image_path: imgPath
          }
        })
      }
      
      const teamQuestions: Record<string, QuizQuestion[]> = {}
      const teamScores: Record<string, number> = { "1": 0, "2": 0 }
      // Use roomSettings directly to ensure correct distribution
      teamQuestions["1"] = allQuestions.slice(0, roomSettings.questionsPerTeam)
      teamQuestions["2"] = allQuestions.slice(roomSettings.questionsPerTeam, allQuestions.length)
      
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

      setTimeRemaining(roomSettings.timePerQuestion)
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
            
            // Trigger Feedback AI - Fixed parameter alignment
            supabase.functions.invoke('generate-feedback', {
                body: { 
                    mode: 'team',
                    scores: teamScores, 
                    questions: currentRoom.team_questions 
                }
            }).then(({ data, error }) => {
                console.log('Feedback response:', { data, error })
                if (error) {
                    console.error('Feedback generation error:', error)
                    // Set fallback feedback
                    const fallbackFeedback = {
                        summary: "Game completed successfully!",
                        strengths: ["Completed the team challenge", "Demonstrated Formula Student knowledge"],
                        weak_points: ["Continue studying regulations", "Practice technical problems"],
                        detailed_analysis: "Both teams showed good effort in this Formula Student quiz challenge. Keep practicing with the rulebook and technical materials.",
                        feedback: "Great job completing the team challenge! Keep studying to improve your Formula Student knowledge."
                    }
                    return supabase.from('team_rooms').update({ feedback: fallbackFeedback }).eq('id', currentRoom.id)
                } else if (data) {
                    // Successfully got feedback, update the room
                    return supabase.from('team_rooms').update({ feedback: data }).eq('id', currentRoom.id)
                } else {
                    console.warn('No data received from feedback function')
                    // Set fallback feedback
                    const fallbackFeedback = {
                        summary: "Game completed successfully!",
                        strengths: ["Completed the team challenge", "Demonstrated Formula Student knowledge"],
                        weak_points: ["Continue studying regulations", "Practice technical problems"],
                        detailed_analysis: "Both teams showed good effort in this Formula Student quiz challenge. Keep practicing with the rulebook and technical materials.",
                        feedback: "Great job completing the team challenge! Keep studying to improve your Formula Student knowledge."
                    }
                    return supabase.from('team_rooms').update({ feedback: fallbackFeedback }).eq('id', currentRoom.id)
                }
            }).then((updateResult) => {
                if (updateResult?.error) {
                    console.error('Error updating room with feedback:', updateResult.error)
                } else {
                    console.log('Feedback successfully saved to room')
                }
            }).catch(error => {
                console.error('Feedback generation failed:', error)
                // Set fallback feedback even on catch
                const fallbackFeedback = {
                    summary: "Game completed successfully!",
                    strengths: ["Completed the team challenge", "Demonstrated Formula Student knowledge"],
                    weak_points: ["Continue studying regulations", "Practice technical problems"],
                    detailed_analysis: "Both teams showed good effort in this Formula Student quiz challenge. Keep practicing with the rulebook and technical materials.",
                    feedback: "Great job completing the team challenge! Keep studying to improve your Formula Student knowledge."
                }
                supabase.from('team_rooms').update({ feedback: fallbackFeedback }).eq('id', currentRoom.id)
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

  // --- RENDER ---
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
            <div className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-mono text-xl font-bold ${timerActive && timeRemaining < 10 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-700'}`}>
              <Clock className="w-5 h-5" />
              <span>{formatTime(timeRemaining)}</span>
            </div>
          </div>
        </div>

        {/* Scoreboard */}
        <div className="grid grid-cols-2 gap-4">
          {[1, 2].map(teamNum => {
            const isTurn = currentRoom.current_turn_team_id === teamNum
            const score = currentRoom.team_scores?.[teamNum] || 0
            return (
              <div key={teamNum} className={`p-4 rounded-xl border-2 transition-all ${isTurn ? 'border-blue-500 bg-blue-50 shadow-md transform scale-105' : 'border-gray-200 bg-white opacity-80'}`}>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-gray-700 flex items-center">
                    <Users className="w-4 h-4 mr-2" /> Team {teamNum}
                  </h3>
                  {isTurn && <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full animate-pulse">Playing</span>}
                </div>
                <div className="text-3xl font-black text-gray-900">{score}</div>
              </div>
            )
          })}
        </div>

        {/* Question Card */}
        <div className="card relative overflow-hidden">
          {isStealMode && (
            <div className="absolute top-0 left-0 right-0 bg-yellow-400 text-yellow-900 text-center py-1 font-bold text-sm uppercase tracking-wider flex items-center justify-center">
              <RotateCcw className="w-4 h-4 mr-2" /> Steal Opportunity
            </div>
          )}
          
          <div className="mt-6 mb-6">
            <div className="flex justify-between items-start mb-4">
              <span className="inline-block px-3 py-1 bg-gray-100 rounded-full text-xs font-semibold text-gray-500 mb-2">
                Question {currentRoom.current_question_index + 1} / {currentRoom.questions_per_team}
              </span>
              <span className={`text-xs font-bold px-2 py-1 rounded ${currentQuestion?.difficulty === 'Hard' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {currentQuestion?.difficulty}
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold text-gray-900 leading-relaxed">
              {currentQuestion?.question}
            </h2>

            {currentQuestion?.image_path && (
              <div className="mt-4 rounded-lg overflow-hidden border border-gray-200">
                <img src={currentQuestion.image_path} alt="Question Diagram" className="w-full h-auto max-h-64 object-contain bg-gray-50" />
              </div>
            )}
          </div>

          {/* Answer Area */}
          <div className="space-y-3">
            {!isUserTurn ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200 border-dashed">
                <Users className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                <p className="text-gray-500 font-medium">Waiting for Team {currentRoom.current_turn_team_id}...</p>
              </div>
            ) : (
              <>
                {currentQuestion?.type === 'input' ? (
                   <input
                    type="text"
                    disabled={hasAnswered}
                    placeholder="Type your answer here..."
                    className="w-full p-4 border-2 border-gray-200 rounded-lg focus:border-blue-500 focus:ring-0 text-lg transition-colors"
                    value={(selectedAnswer as string) || ''}
                    onChange={(e) => setSelectedAnswer(e.target.value)}
                  />
                ) : (
                  <div className="grid gap-3">
                    {currentQuestion?.options?.map((option: string, idx: number) => {
                      const isMulti = currentQuestion.type === 'multi_choice'
                      const isSelected = isMulti 
                        ? (selectedAnswer as number[])?.includes(idx)
                        : selectedAnswer === idx

                      return (
                        <button
                          key={idx}
                          disabled={hasAnswered}
                          onClick={() => {
                            if (isMulti) handleMultiChoiceSelect(idx)
                            else setSelectedAnswer(idx)
                          }}
                          className={`w-full p-4 rounded-lg border-2 text-left transition-all flex items-center justify-between group
                            ${isSelected 
                              ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' 
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                            } ${hasAnswered ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center">
                            <span className={`w-6 h-6 rounded flex items-center justify-center text-xs mr-3 border transition-colors
                              ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'bg-white border-gray-300 text-gray-500 group-hover:border-gray-400'}`}>
                              {isMulti ? (isSelected ? <CheckSquare className="w-4 h-4"/> : <Square className="w-4 h-4"/>) : String.fromCharCode(65 + idx)}
                            </span>
                            {option}
                          </div>
                          {isSelected && <CheckCircle className="w-5 h-5 text-blue-500" />}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Consensus & Submit Footer */}
                <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center space-x-2 text-sm text-gray-500">
                    <div className="flex -space-x-2">
                      {currentTeamMembers.map((m) => {
                        const hasSub = currentRoom.current_answers?.[m.user_id]
                        return (
                           <div key={m.user_id} className={`w-8 h-8 rounded-full flex items-center justify-center border-2 border-white text-xs font-bold text-white
                             ${hasSub ? 'bg-green-500' : 'bg-gray-300'}`} title={m.user_email}>
                             {hasSub ? <Check className="w-4 h-4" /> : '...'}
                           </div>
                        )
                      })}
                    </div>
                    <span>{teamAnswers.length}/{currentTeamMembers.length} answered</span>
                  </div>

                  <button
                    onClick={submitAnswer}
                    disabled={hasAnswered || selectedAnswer === null || (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) || (typeof selectedAnswer === 'string' && !selectedAnswer.trim())}
                    className={`btn-primary w-full md:w-auto px-8 py-3 flex items-center justify-center space-x-2 ${hasAnswered ? 'bg-gray-400 cursor-not-allowed' : ''}`}
                  >
                    <span>{hasAnswered ? 'Waiting for Consensus...' : 'Submit Answer'}</span>
                    {!hasAnswered && <Send className="w-4 h-4" />}
                  </button>
                </div>
                
                {hasAnswered && !hasConsensus && teamAnswers.length === currentTeamMembers.length && (
                   <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm text-center flex items-center justify-center animate-pulse">
                      <XCircle className="w-4 h-4 mr-2" />
                      Team disagreement! Discuss and update answers.
                   </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: LOBBY (DEFAULT) ---
  return (
    <div className="max-w-4xl mx-auto space-y-8 px-4 py-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-black text-gray-900 tracking-tight">Team Battle</h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Compete in real-time. Collaborate with your team. Master the rules.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        {/* Create Room Card */}
        <button 
          onClick={() => setShowCreateRoom(true)}
          className="group p-8 bg-white rounded-2xl shadow-sm border-2 border-gray-100 hover:border-blue-500 hover:shadow-md transition-all text-left"
        >
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4 group-hover:scale-110 transition-transform">
            <Plus className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Create Room</h2>
          <p className="text-gray-500">Host a new game, configure settings, and invite players.</p>
        </button>

        {/* Join Room Card */}
        <button 
          onClick={() => setShowJoinRoom(true)}
          className="group p-8 bg-white rounded-2xl shadow-sm border-2 border-gray-100 hover:border-purple-500 hover:shadow-md transition-all text-left"
        >
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 mb-4 group-hover:scale-110 transition-transform">
            <LogIn className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Join Room</h2>
          <p className="text-gray-500">Enter a code to join an existing team lobby.</p>
        </button>
      </div>

      {/* Active Rooms List */}
      {rooms.length > 0 && (
        <div className="mt-12">
          <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <Database className="w-5 h-5 mr-2 text-gray-400" /> Public Rooms
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
             {rooms.map(room => (
               <div key={room.id} className="card hover:shadow-md transition-shadow cursor-pointer" onClick={() => { setRoomCode(room.code); joinRoom(); }}>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold truncate">{room.name}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs ${room.room_status === 'lobby' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {room.room_status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 flex items-center justify-between">
                     <span>Host: Team {room.created_by === user?.id ? '(You)' : 'Leader'}</span>
                     <span className="font-mono bg-gray-100 px-1 rounded">{room.code}</span>
                  </div>
               </div>
             ))}
          </div>
        </div>
      )}

      {/* --- MODALS --- */}

      {/* 1. Create Room Modal */}
      {showCreateRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6">Create New Room</h2>
            
            <div className="space-y-6">
              {/* Basic Info */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room Name</label>
                <input 
                  value={roomName} onChange={e => setRoomName(e.target.value)} 
                  className="input-field" placeholder="e.g. FS Austria Prep" 
                />
              </div>

              {/* Game Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Questions per Team</label>
                    <select 
                      value={roomSettings.questionsPerTeam}
                      onChange={e => setRoomSettings({...roomSettings, questionsPerTeam: parseInt(e.target.value)})}
                      className="input-field"
                    >
                      <option value={5}>5 Questions</option>
                      <option value={10}>10 Questions</option>
                      <option value={15}>15 Questions</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time per Question</label>
                    <select 
                      value={roomSettings.timePerQuestion}
                      onChange={e => setRoomSettings({...roomSettings, timePerQuestion: parseInt(e.target.value)})}
                      className="input-field"
                    >
                      <option value={30}>30 Seconds</option>
                      <option value={60}>60 Seconds</option>
                      <option value={90}>90 Seconds</option>
                      <option value={120}>2 Minutes</option>
                    </select>
                 </div>
              </div>

              <div className="border-t border-gray-100 my-4"></div>

              {/* Question Source Selection */}
              <div className="space-y-4">
                <div className="flex space-x-4 p-1 bg-gray-100 rounded-lg">
                  <button 
                    onClick={() => setQuizMode('official')}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${quizMode === 'official' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
                  >
                    <div className="flex items-center justify-center"><Database className="w-4 h-4 mr-2"/>Official Bank</div>
                  </button>
                  <button 
                    onClick={() => setQuizMode('ai')}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${quizMode === 'ai' ? 'bg-white shadow text-purple-600' : 'text-gray-500'}`}
                  >
                    <div className="flex items-center justify-center"><Brain className="w-4 h-4 mr-2"/>AI Generation</div>
                  </button>
                </div>

                {quizMode === 'official' ? (
                   <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Year</label>
                        <select 
                          className="input-field mt-1 text-sm"
                          value={roomSettings.yearFilter}
                          onChange={(e) => setRoomSettings({...roomSettings, yearFilter: e.target.value})}
                        >
                          <option value="all">All Years</option>
                          <option value="2024">2024</option>
                          <option value="2023">2023</option>
                          <option value="2022">2022</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Event</label>
                        <select 
                          className="input-field mt-1 text-sm"
                          value={roomSettings.sourceFilter}
                          onChange={(e) => setRoomSettings({...roomSettings, sourceFilter: e.target.value})}
                        >
                          <option value="all">All Events</option>
                          <option value="FSG">FS Germany</option>
                          <option value="FSA">FS Austria</option>
                          <option value="FSEast">FS East</option>
                        </select>
                      </div>
                   </div>
                ) : (
                   <div className="bg-purple-50 p-4 rounded-lg border border-purple-100">
                      <h4 className="text-sm font-bold text-purple-900 mb-2 flex items-center"><FileText className="w-4 h-4 mr-2"/> Select Context Documents</h4>
                      <div className="max-h-32 overflow-y-auto space-y-2">
                        {availableDocuments.map(doc => (
                          <label key={doc.id} className="flex items-center space-x-2 text-sm text-gray-700 cursor-pointer hover:bg-purple-100 p-1 rounded">
                             <input 
                               type="checkbox" 
                               checked={selectedDocuments.has(doc.id)} 
                               onChange={() => toggleDocumentSelection(doc.id)}
                               className="rounded text-purple-600 focus:ring-purple-500"
                             />
                             <span className="truncate">{doc.title}</span>
                          </label>
                        ))}
                      </div>
                      {availableDocuments.length === 0 && <p className="text-xs text-purple-600 mt-2">No documents found. Upload PDFs in the Library tab.</p>}
                   </div>
                )}
              </div>

              <div className="flex space-x-3 pt-4">
                <button onClick={() => setShowCreateRoom(false)} className="flex-1 btn-secondary">Cancel</button>
                <button onClick={createRoom} disabled={loading} className="flex-1 btn-primary">
                  {loading ? <Loader className="w-5 h-5 animate-spin mx-auto"/> : 'Create Room'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Join Room Modal */}
      {showJoinRoom && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Join Room</h2>
            <input 
              value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} 
              className="input-field text-center text-2xl font-mono tracking-widest mb-6 uppercase placeholder:text-sm placeholder:font-sans placeholder:tracking-normal" 
              placeholder="Enter 6-digit code" maxLength={6}
            />
            <div className="flex space-x-3">
              <button onClick={() => setShowJoinRoom(false)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={joinRoom} disabled={loading} className="flex-1 btn-primary">
                {loading ? <Loader className="w-5 h-5 animate-spin mx-auto"/> : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Team Selection Modal (Triggered during Join if not assigned) */}
      {showTeamSelection && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center">
            <h2 className="text-2xl font-bold mb-2">Select Your Team</h2>
            <p className="text-gray-500 mb-6">Choose which side you want to battle on.</p>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button onClick={() => setSelectedTeam(1)} className={`p-4 rounded-xl border-2 transition-all ${selectedTeam === 1 ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <div className="font-bold text-lg mb-1">Team 1</div>
                <Users className="w-6 h-6 mx-auto text-blue-500"/>
              </button>
              <button onClick={() => setSelectedTeam(2)} className={`p-4 rounded-xl border-2 transition-all ${selectedTeam === 2 ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}>
                <div className="font-bold text-lg mb-1">Team 2</div>
                <Users className="w-6 h-6 mx-auto text-red-500"/>
              </button>
            </div>

            <div className="flex space-x-3">
              <button onClick={() => setShowTeamSelection(false)} className="flex-1 btn-secondary">Cancel</button>
              <button onClick={() => confirmTeamSelection(selectedTeam)} disabled={loading} className="flex-1 btn-primary">
                {loading ? <Loader className="w-5 h-5 animate-spin mx-auto"/> : 'Confirm Selection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Room Lobby (Waiting State) */}
      {currentRoom && currentRoom.room_status === 'lobby' && (
        <div className="fixed inset-0 bg-white z-40 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            <div className="flex justify-between items-center mb-8">
               <h1 className="text-3xl font-bold">{currentRoom.name}</h1>
               <button onClick={leaveRoom} className="text-gray-500 hover:text-red-500"><XCircle /></button>
            </div>

            <div className="bg-blue-600 text-white rounded-2xl p-8 text-center mb-8 shadow-lg relative overflow-hidden">
               <div className="relative z-10">
                 <p className="text-blue-100 mb-2 font-medium">ROOM CODE</p>
                 <div className="text-6xl font-black font-mono tracking-wider mb-4">{currentRoom.code}</div>
                 <p className="text-blue-200">Share this code with your teammates</p>
               </div>
               <div className="absolute -right-10 -top-10 text-blue-500/30 rotate-12"><Users size={200} /></div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Team 1 Roster */}
              <div className="card">
                <h3 className="font-bold text-lg mb-4 flex items-center text-blue-700">
                  <span className="w-2 h-2 rounded-full bg-blue-500 mr-2"></span> Team 1
                </h3>
                <div className="space-y-2">
                  {participants.filter(p => p.team_number === 1).map(p => (
                    <div key={p.user_id} className="flex items-center p-2 bg-gray-50 rounded">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold mr-3">
                        {p.user_email.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{p.user_email}</span>
                      {p.user_id === currentRoom.created_by && <Crown className="w-4 h-4 ml-auto text-yellow-500" />}
                    </div>
                  ))}
                  {participants.filter(p => p.team_number === 1).length === 0 && <p className="text-gray-400 italic text-sm">Waiting for players...</p>}
                </div>
              </div>

              {/* Team 2 Roster */}
              <div className="card">
                <h3 className="font-bold text-lg mb-4 flex items-center text-red-700">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-2"></span> Team 2
                </h3>
                <div className="space-y-2">
                  {participants.filter(p => p.team_number === 2).map(p => (
                    <div key={p.user_id} className="flex items-center p-2 bg-gray-50 rounded">
                      <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center text-red-600 font-bold mr-3">
                        {p.user_email.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{p.user_email}</span>
                    </div>
                  ))}
                  {participants.filter(p => p.team_number === 2).length === 0 && <p className="text-gray-400 italic text-sm">Waiting for players...</p>}
                </div>
              </div>
            </div>

            {/* Host Controls */}
            {isRoomCreator && (
               <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t flex justify-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
                 <div className="max-w-4xl w-full flex justify-between items-center">
                    <div className="text-sm text-gray-500">
                       <span className="font-bold">{participants.length}</span> players ready
                    </div>
                    <button 
                      onClick={startGame} 
                      disabled={loading || participants.length < 2}
                      className="btn-primary px-8 py-3 text-lg shadow-lg shadow-blue-500/30 flex items-center"
                    >
                      {loading ? <Loader className="animate-spin mr-2"/> : <Play className="fill-current mr-2 w-5 h-5"/>}
                      Start Game
                    </button>
                 </div>
               </div>
            )}
            
            {!isRoomCreator && (
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-lg flex items-center animate-bounce">
                <Loader className="w-4 h-4 animate-spin mr-3" />
                Waiting for host to start...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
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
                                    <UserCheck className="w-5 h-5 mr-2" /> Answer Submitted. Waiting for team...
                                </div>
                            ) : (
                                <div className="flex flex-col gap-4">
                                    <div className="flex justify-between items-center text-sm text-gray-600">
                                        <span>Consensus Progress:</span>
                                        <span className="font-bold">{teamAnswers.length} / {currentTeamMembers.length}</span>
                                    </div>
                                    {hasConsensus && <div className="text-center text-green-600 font-bold flex items-center justify-center"><CheckCircle className="w-4 h-4 mr-2"/> Consensus Reached!</div>}
                                    <button onClick={submitAnswer} 
                                        disabled={selectedAnswer === null || (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '')}
                                        className="btn-primary w-full py-3 text-lg shadow-sm">
                                        <Send className="w-5 h-5 mr-2" /> Submit Answer
                                    </button>
                                </div>
                            )}
                          </>
                      ) : (
                          <div className="text-center text-gray-500 italic">Spectating...</div>
                      )}
                  </div>
                </>
              ) : <div className="text-center py-12"><Loader className="w-10 h-10 animate-spin mx-auto text-primary-500"/><p className="mt-4">Loading Question...</p></div>}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="card">
              <h3 className="font-bold mb-4">Scores</h3>
              {[1, 2].map(num => (
                <div key={num} className={`p-3 rounded border mb-2 flex justify-between ${num===currentRoom.current_turn_team_id?'bg-primary-50 border-primary-200':''}`}>
                  <span>Team {num}</span><span className="font-bold">{currentRoom.team_scores[num] || 0}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <h3 className="font-bold mb-4">Participants</h3>
              <div className="space-y-2">
                {participants.map(p => (
                   <div key={p.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded">
                      <div className="flex items-center space-x-2">
                         {p.user_id === currentRoom.created_by && <Crown className="w-3 h-3 text-yellow-500"/>}
                         <span className="truncate max-w-[120px]">{p.user_email}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 bg-gray-200 rounded text-xs">T{p.team_number}</span>
                        {currentQuestion && p.team_number === currentRoom.current_turn_team_id && (
                             currentAnswers[p.user_id] ? <CheckCircle className="w-4 h-4 text-green-500" /> : <div className="w-4 h-4 rounded-full border border-gray-300" />
                        )}
                      </div>
                   </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // --- VIEW: LOBBY ---
  if (currentRoom && currentRoom.room_status === 'lobby') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex justify-between items-center">
            <div><h1 className="text-2xl font-bold">{currentRoom.name}</h1><p>Code: {currentRoom.code}</p></div>
            <div className="flex gap-2"><button onClick={leaveRoom} className="btn-secondary">Leave</button>{isRoomCreator && <button onClick={()=>deleteRoom(currentRoom.id)} className="btn-secondary text-red-600">Delete</button>}</div>
        </div>
        
        {/* Quiz Configuration Section */}
        {isRoomCreator && (
          <div className="card space-y-6">
            <h2 className="text-lg font-bold text-gray-900">Quiz Configuration</h2>
            
            {/* Mode Selector */}
            <div className="flex justify-center">
              <div className="bg-gray-100 p-1 rounded-lg flex space-x-1">
                <button 
                  onClick={() => setQuizMode('official')}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                    quizMode === 'official' ? 'bg-white shadow text-primary-700' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <div className="flex items-center">
                    <Database className="w-4 h-4 mr-2" />
                    Official Question Bank
                  </div>
                </button>
                <button 
                  onClick={() => setQuizMode('ai')}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                    quizMode === 'ai' ? 'bg-white shadow text-primary-700' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <div className="flex items-center">
                    <Brain className="w-4 h-4 mr-2" />
                    AI Generator
                  </div>
                </button>
              </div>
            </div>
            
            {/* Official Mode Filters */}
            {quizMode === 'official' && (
              <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div>
                  <label className="block text-xs font-bold text-blue-800 uppercase tracking-wide mb-2 flex items-center">
                    <Filter className="w-3 h-3 mr-1" /> Competition
                  </label>
                  <select 
                    value={roomSettings.sourceFilter}
                    onChange={(e) => setRoomSettings(prev => ({...prev, sourceFilter: e.target.value}))}
                    className="input-field w-full bg-white text-sm"
                  >
                    <option value="all">All Events</option>
                    <option value="FSG">FS Germany</option>
                    <option value="FSN">FS Netherlands</option>
                    <option value="FSA">FS Austria</option>
                    <option value="FS East">FS East</option>
                    <option value="FSCH">FS Switzerland</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-blue-800 uppercase tracking-wide mb-2 flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> Year
                  </label>
                  <select 
                    value={roomSettings.yearFilter}
                    onChange={(e) => setRoomSettings(prev => ({...prev, yearFilter: e.target.value}))}
                    className="input-field w-full bg-white text-sm"
                  >
                    <option value="all">All Years</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                    <option value="2023">2023</option>
                    <option value="2022">2022</option>
                    <option value="2021">2021</option>
                  </select>
                </div>
              </div>
            )}

            {/* AI Mode Document Selector */}
            {quizMode === 'ai' && (
              <div>
                <div className="flex items-center space-x-2 mb-3">
                  <BookOpen className="w-5 h-5 text-primary-600" />
                  <h3 className="text-base font-medium text-gray-900">Select Knowledge Base</h3>
                </div>
                <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
                  {availableDocuments.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 bg-gray-50">
                      No documents found. Go to "Documents" to upload content.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 bg-gray-50">
                      {availableDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          onClick={() => toggleDocumentSelection(doc.id)}
                          className={`flex items-center space-x-3 p-3 cursor-pointer transition-colors hover:bg-white ${
                            selectedDocuments.has(doc.id) ? 'bg-primary-50' : ''
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                            selectedDocuments.has(doc.id)
                              ? 'bg-primary-600 border-primary-600 text-white'
                              : 'border-gray-300 bg-white'
                          }`}>
                            {selectedDocuments.has(doc.id) && <Check className="w-3 h-3" />}
                          </div>
                          <span className={`text-sm font-medium truncate ${selectedDocuments.has(doc.id) ? 'text-primary-900' : 'text-gray-700'}`}>
                            {doc.name}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Common Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Questions per Team
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Hash className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="number"
                    min="1"
                    max="25"
                    value={roomSettings.questionsPerTeam}
                    onChange={(e) => setRoomSettings(prev => ({ ...prev, questionsPerTeam: Math.max(1, parseInt(e.target.value) || 0) }))}
                    className="input-field pl-10 w-full"
                    placeholder="e.g. 10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                  Time per Question (s)
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Clock className="h-5 w-5 text-gray-400" />
                  </div>
                  <select
                    value={roomSettings.timePerQuestion}
                    onChange={(e) => setRoomSettings(prev => ({ ...prev, timePerQuestion: parseInt(e.target.value) }))}
                    className="input-field pl-10 w-full"
                  >
                    <option value={30}>30s</option>
                    <option value={60}>60s</option>
                    <option value={90}>90s</option>
                    <option value={120}>120s</option>
                  </select>
                </div>
              </div>

              <div className="flex items-end">
                <button 
                  onClick={startGame} 
                  disabled={loading || participants.length < 2 || (quizMode === 'ai' && selectedDocuments.size === 0)} 
                  className="btn-primary w-full py-3 text-base shadow-sm flex justify-center items-center"
                >
                  {loading ? (
                    <>
                      <Loader className="w-5 h-5 animate-spin mr-2" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 mr-2" />
                      Start Game
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="grid md:grid-cols-2 gap-6">
            <div className="card">
                <h2 className="font-bold mb-4">Players ({participants.length})</h2>
                {[1, 2].map(t => (
                    <div key={t} className="mb-4">
                        <h3 className="text-sm font-bold text-gray-500 uppercase">Team {t}</h3>
                        {participants.filter(p=>p.team_number===t).map(p=><div key={p.id} className="text-sm py-1">{p.user_email}</div>)}
                    </div>
                ))}
            </div>
            <div className="card">
                <h2 className="font-bold mb-4">Current Settings</h2>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>Mode:</span><b>{quizMode === 'official' ? 'Official Bank' : 'AI Generated'}</b></div>
                    <div className="flex justify-between"><span>Questions/Team:</span><b>{roomSettings.questionsPerTeam}</b></div>
                    <div className="flex justify-between"><span>Time per Question:</span><b>{roomSettings.timePerQuestion}s</b></div>
                    {quizMode === 'official' && (
                      <>
                        <div className="flex justify-between"><span>Competition:</span><b>{roomSettings.sourceFilter}</b></div>
                        <div className="flex justify-between"><span>Year:</span><b>{roomSettings.yearFilter}</b></div>
                      </>
                    )}
                    {quizMode === 'ai' && (
                      <div className="flex justify-between"><span>Documents:</span><b>{selectedDocuments.size} selected</b></div>
                    )}
                </div>
            </div>
        </div>
      </div>
    )
  }

  // --- VIEW: MAIN MENU ---
  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Team Challenge</h1>
      
      {/* Team Selection Modal */}
      {showTeamSelection && (
        <div className="fixed inset-0 bg-gray-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Select Your Team</h3>
            <p className="text-gray-600 mb-6">Choose which team you'd like to join for this challenge.</p>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button
                onClick={() => confirmTeamSelection(1)}
                disabled={loading}
                className="p-4 border-2 border-primary-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors text-center"
              >
                <div className="text-2xl font-bold text-primary-600 mb-2">Team 1</div>
                <div className="text-sm text-gray-600">Join Team 1</div>
              </button>
              
              <button
                onClick={() => confirmTeamSelection(2)}
                disabled={loading}
                className="p-4 border-2 border-green-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors text-center"
              >
                <div className="text-2xl font-bold text-green-600 mb-2">Team 2</div>
                <div className="text-sm text-gray-600">Join Team 2</div>
              </button>
            </div>
            
            <button
              onClick={() => {
                setShowTeamSelection(false)
                setPendingRoomId(null)
                setShowJoinRoom(false)
              }}
              className="btn-secondary w-full"
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* Create Room */}
        <div className="card text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-100 rounded-lg flex items-center justify-center mx-auto mb-4"><Plus className="w-5 h-5 sm:w-6 sm:h-6 text-primary-600" /></div>
            <h2 className="text-base sm:text-lg font-semibold mb-2">Create Room</h2>
            {showCreateRoom ? (
                <div className="space-y-3 sm:space-y-4 text-left">
                    <input type="text" placeholder="Room Name" value={roomName} onChange={e=>setRoomName(e.target.value)} className="input-field"/>
                    <div className="flex flex-col sm:flex-row gap-2"><button onClick={createRoom} className="btn-primary flex-1">Create</button><button onClick={()=>setShowCreateRoom(false)} className="btn-secondary">Cancel</button></div>
                </div>
            ) : <button onClick={()=>setShowCreateRoom(true)} className="btn-primary">Create</button>}
        </div>
        {/* Join Room */}
        <div className="card text-center">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto mb-4"><LogIn className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" /></div>
            <h2 className="text-base sm:text-lg font-semibold mb-2">Join Room</h2>
            {showJoinRoom ? (
                <div className="space-y-3 sm:space-y-4">
                    <input type="text" placeholder="CODE" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} className="input-field text-center font-mono uppercase"/>
                    <div className="flex flex-col sm:flex-row gap-2"><button onClick={joinRoom} className="btn-primary flex-1">Join</button><button onClick={()=>setShowJoinRoom(false)} className="btn-secondary">Cancel</button></div>
                </div>
            ) : <button onClick={()=>setShowJoinRoom(true)} className="btn-primary">Join</button>}
        </div>
      </div>
      {/* Active Rooms */}
      {rooms.length > 0 && (
          <div className="card">
              <h2 className="text-base sm:text-lg font-bold mb-4">Active Rooms</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {rooms.map(r => (
                      <div key={r.id} className="p-3 sm:p-4 border rounded hover:bg-gray-50 relative">
                          {user?.id === r.created_by && <button onClick={e=>{e.stopPropagation(); deleteRoom(r.id)}} className="absolute top-2 right-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>}
                          <h3 className="font-medium text-sm sm:text-base truncate pr-6">{r.name}</h3>
                          <button onClick={()=>{setRoomCode(r.code); setShowJoinRoom(true)}} className="btn-secondary w-full mt-2 text-sm">Join</button>
                      </div>
                  ))}
              </div>
          </div>
      )}
    </div>
  )
}