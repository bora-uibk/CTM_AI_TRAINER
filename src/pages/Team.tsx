import React, { useState, useEffect } from 'react'
import { supabase, TeamRoom, RoomParticipant, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Users, 
  Plus, 
  LogIn, 
  Crown, 
  UserCheck,
  Send,
  RotateCcw,
  Trophy,
  Loader,
  Clock,
  Play,
  Settings,
  CheckCircle,
  XCircle,
  Timer,
  Target,
  Award
} from 'lucide-react'

export default function Team() {
  const { user } = useAuth()
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [currentRoom, setCurrentRoom] = useState<TeamRoom | null>(null)
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
  
  // Room creation settings
  const [roomSettings, setRoomSettings] = useState({
    numTeams: 2,
    questionsPerTeam: 10,
    timePerQuestion: 60
  })

  useEffect(() => {
    fetchRooms()
  }, [])

  useEffect(() => {
    if (currentRoom) {
      fetchParticipants()
      subscribeToRoomUpdates()
    }
  }, [currentRoom])

  // Timer effect
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

    const subscription = supabase
      .channel(`room-${currentRoom.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_rooms',
        filter: `id=eq.${currentRoom.id}`
      }, (payload) => {
        if (payload.new) {
          const updatedRoom = payload.new as TeamRoom
          setCurrentRoom(updatedRoom)
          
          // Update timer when question changes
          if (updatedRoom.room_status === 'in_progress' && updatedRoom.current_question) {
            setTimeRemaining(updatedRoom.time_per_question)
            setTimerActive(true)
          }
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_participants',
        filter: `room_id=eq.${currentRoom.id}`
      }, () => {
        fetchParticipants()
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
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
          num_teams: roomSettings.numTeams,
          questions_per_team: roomSettings.questionsPerTeam,
          time_per_question: roomSettings.timePerQuestion,
          current_turn_team_id: 1,
          current_question_index: 0,
          team_questions: {},
          team_scores: {},
          room_status: 'lobby',
          current_question: null,
          current_answers: {}
        })
        .select()
        .single()

      if (error) throw error

      // Join the room as creator (Team 1)
      await supabase
        .from('room_participants')
        .insert({
          room_id: data.id,
          user_id: user.id,
          user_email: user.email || '',
          team_number: 1
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

      // Check if already joined
      const { data: existing } = await supabase
        .from('room_participants')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', user.id)
        .single()

      if (!existing) {
        await supabase
          .from('room_participants')
          .insert({
            room_id: room.id,
            user_id: user.id,
            user_email: user.email || '',
            team_number: selectedTeam
          })
      }

      setCurrentRoom(room)
      setShowJoinRoom(false)
      setRoomCode('')
    } catch (error) {
      console.error('Error joining room:', error)
      alert('Failed to join room. Please check the room code.')
    } finally {
      setLoading(false)
    }
  }

  const leaveRoom = async () => {
    if (!currentRoom || !user) return

    try {
      await supabase
        .from('room_participants')
        .delete()
        .eq('room_id', currentRoom.id)
        .eq('user_id', user.id)

      setCurrentRoom(null)
      setParticipants([])
      setSelectedAnswer(null)
      setTimerActive(false)
      setTimeRemaining(0)
    } catch (error) {
      console.error('Error leaving room:', error)
    }
  }

  const startGame = async () => {
    if (!currentRoom || currentRoom.created_by !== user?.id) return

    setLoading(true)
    try {
      // Generate questions for all teams
      const totalQuestions = currentRoom.num_teams * currentRoom.questions_per_team
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { count: totalQuestions }
      })

      if (error) throw error

      // Distribute questions among teams
      const teamQuestions: Record<string, QuizQuestion[]> = {}
      const teamScores: Record<string, number> = {}
      
      for (let i = 1; i <= currentRoom.num_teams; i++) {
        teamQuestions[i.toString()] = data.questions.slice(
          (i - 1) * currentRoom.questions_per_team,
          i * currentRoom.questions_per_team
        )
        teamScores[i.toString()] = 0
      }

      // Start the game
      await supabase
        .from('team_rooms')
        .update({
          room_status: 'in_progress',
          team_questions: teamQuestions,
          team_scores: teamScores,
          current_turn_team_id: 1,
          current_question_index: 0,
          current_question: teamQuestions['1'][0],
          current_answers: {}
        })
        .eq('id', currentRoom.id)

      setSelectedAnswer(null)
    } catch (error) {
      console.error('Error starting game:', error)
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

      await supabase
        .from('team_rooms')
        .update({ current_answers: currentAnswers })
        .eq('id', currentRoom.id)

      // Check if all team members have answered with the same answer
      checkTeamConsensus()
    } catch (error) {
      console.error('Error submitting answer:', error)
    }
  }

  const checkTeamConsensus = async () => {
    if (!currentRoom || !user) return

    const currentTeamMembers = participants.filter(p => p.team_number === currentRoom.current_turn_team_id)
    const currentAnswers = currentRoom.current_answers || {}
    
    // Get answers from current team members
    const teamAnswers = currentTeamMembers
      .map(member => currentAnswers[member.user_id])
      .filter(answer => answer !== undefined)

    // Check if all team members have answered
    if (teamAnswers.length === currentTeamMembers.length) {
      // Check if all answers are the same
      const firstAnswer = teamAnswers[0]?.answer
      const allSame = teamAnswers.every(answer => answer.answer === firstAnswer)

      if (allSame) {
        // Consensus reached, advance to next question
        await advanceToNextQuestion(firstAnswer)
      }
    }
  }

  const advanceToNextQuestion = async (teamAnswer: string | number) => {
    if (!currentRoom) return

    try {
      const currentTeam = currentRoom.current_turn_team_id
      const currentQuestion = currentRoom.current_question as QuizQuestion
      const isCorrect = teamAnswer === currentQuestion.correct_answer

      // Update team score
      const teamScores = { ...currentRoom.team_scores }
      if (isCorrect) {
        teamScores[currentTeam.toString()] = (teamScores[currentTeam.toString()] || 0) + 1
      }

      // Determine next state
      let nextTeam = currentTeam
      let nextQuestionIndex = currentRoom.current_question_index
      let nextQuestion = null
      let roomStatus = currentRoom.room_status

      // Move to next team
      nextTeam = (currentTeam % currentRoom.num_teams) + 1
      
      // If we've cycled through all teams, move to next question index
      if (nextTeam === 1) {
        nextQuestionIndex++
      }

      // Check if game is finished
      const maxQuestions = Math.max(...Object.values(currentRoom.team_questions).map((q: any) => q.length))
      if (nextQuestionIndex >= maxQuestions) {
        roomStatus = 'finished'
        await supabase
          .from('team_rooms')
          .update({
            room_status: 'finished',
            is_active: false,
            team_scores: teamScores,
            current_answers: {}
          })
          .eq('id', currentRoom.id)
      } else {
        // Get next question for the next team
        const teamQuestions = currentRoom.team_questions[nextTeam.toString()] || []
        if (nextQuestionIndex < teamQuestions.length) {
          nextQuestion = teamQuestions[nextQuestionIndex]
        }

        await supabase
          .from('team_rooms')
          .update({
            current_turn_team_id: nextTeam,
            current_question_index: nextQuestionIndex,
            current_question: nextQuestion,
            current_answers: {},
            team_scores: teamScores
          })
          .eq('id', currentRoom.id)
      }

      setSelectedAnswer(null)
      setTimerActive(false)
      setTimeRemaining(0)
    } catch (error) {
      console.error('Error advancing question:', error)
    }
  }

  const handleTimeUp = async () => {
    if (!currentRoom) return

    setTimerActive(false)
    // Time's up - treat as PASS and move to next question
    await advanceToNextQuestion('PASS')
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const isRoomCreator = currentRoom?.created_by === user?.id
  const currentQuestion = currentRoom?.current_question as QuizQuestion | null
  const currentAnswers = currentRoom?.current_answers || {}
  const userParticipant = participants.find(p => p.user_id === user?.id)
  const isUserTurn = userParticipant?.team_number === currentRoom?.current_turn_team_id
  const hasAnswered = user?.id && currentAnswers[user.id]

  // Get team members for current turn
  const currentTeamMembers = participants.filter(p => p.team_number === currentRoom?.current_turn_team_id)
  const teamAnswers = currentTeamMembers
    .map(member => currentAnswers[member.user_id])
    .filter(answer => answer !== undefined)

  // Check consensus
  const allTeamMembersAnswered = teamAnswers.length === currentTeamMembers.length
  const firstAnswer = teamAnswers[0]?.answer
  const hasConsensus = allTeamMembersAnswered && teamAnswers.every(answer => answer.answer === firstAnswer)

  // Room finished - show results
  if (currentRoom?.room_status === 'finished') {
    const teamScores = currentRoom.team_scores || {}
    const sortedTeams = Object.entries(teamScores)
      .sort(([,a], [,b]) => (b as number) - (a as number))

    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Game Finished!</h1>
          <p className="text-gray-600">{currentRoom.name}</p>
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6 text-center">Final Results</h2>
          
          <div className="space-y-4">
            {sortedTeams.map(([teamId, score], index) => {
              const teamMembers = participants.filter(p => p.team_number === parseInt(teamId))
              const isWinner = index === 0
              
              return (
                <div
                  key={teamId}
                  className={`p-4 rounded-lg border-2 ${
                    isWinner 
                      ? 'border-yellow-400 bg-yellow-50' 
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {isWinner && <Crown className="w-5 h-5 text-yellow-500" />}
                      <h3 className="font-semibold text-gray-900">
                        Team {teamId} {isWinner && '🏆'}
                      </h3>
                    </div>
                    <div className="text-2xl font-bold text-primary-600">
                      {score}/{currentRoom.questions_per_team}
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-600">
                    Members: {teamMembers.map(m => m.user_email).join(', ')}
                  </div>
                  
                  <div className="mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          isWinner ? 'bg-yellow-500' : 'bg-primary-500'
                        }`}
                        style={{ 
                          width: `${((score as number) / currentRoom.questions_per_team) * 100}%` 
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-8 text-center">
            <button onClick={leaveRoom} className="btn-primary">
              Leave Room
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Game in progress
  if (currentRoom && currentRoom.room_status === 'in_progress') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{currentRoom.name}</h1>
            <p className="text-gray-600">Room Code: <span className="font-mono font-bold">{currentRoom.code}</span></p>
          </div>
          <button onClick={leaveRoom} className="btn-secondary">
            Leave Room
          </button>
        </div>

        {/* Game Status */}
        <div className="card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary-600">Team {currentRoom.current_turn_team_id}</div>
                <div className="text-sm text-gray-600">Current Turn</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {currentRoom.current_question_index + 1}/{currentRoom.questions_per_team}
                </div>
                <div className="text-sm text-gray-600">Question</div>
              </div>
            </div>
            
            {timerActive && (
              <div className="flex items-center space-x-2">
                <Timer className={`w-5 h-5 ${timeRemaining < 10 ? 'text-danger-600' : 'text-primary-600'}`} />
                <span className={`text-2xl font-mono font-bold ${
                  timeRemaining < 10 ? 'text-danger-600' : 'text-primary-600'
                }`}>
                  {formatTime(timeRemaining)}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Question Area */}
          <div className="lg:col-span-2">
            <div className="card">
              {currentQuestion ? (
                <div>
                  <div className="mb-4">
                    <div className="flex items-center space-x-2 mb-2">
                      <Target className="w-5 h-5 text-primary-600" />
                      <span className="font-medium text-primary-600">
                        Team {currentRoom.current_turn_team_id}'s Question
                      </span>
                    </div>
                    {!isUserTurn && (
                      <div className="p-3 bg-gray-100 rounded-lg mb-4">
                        <p className="text-gray-600 text-center">
                          Waiting for Team {currentRoom.current_turn_team_id} to answer...
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="mb-6">
                    <p className="text-lg text-gray-900 mb-4">{currentQuestion.question}</p>
                    
                    {currentQuestion.type === 'multiple_choice' && currentQuestion.options && (
                      <div className="space-y-3">
                        {currentQuestion.options.map((option, index) => (
                          <button
                            key={index}
                            onClick={() => setSelectedAnswer(index)}
                            disabled={!isUserTurn || hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all duration-200 ${
                              selectedAnswer === index
                                ? 'border-primary-500 bg-primary-50'
                                : !isUserTurn || hasAnswered
                                ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span>{String.fromCharCode(65 + index)}. {option}</span>
                              <div className="flex items-center space-x-1">
                                {teamAnswers.filter(a => a.answer === index).map((_, i) => (
                                  <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />
                                ))}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {currentQuestion.type === 'true_false' && (
                      <div className="space-y-3">
                        {[true, false].map((value) => (
                          <button
                            key={value.toString()}
                            onClick={() => setSelectedAnswer(value)}
                            disabled={!isUserTurn || hasAnswered}
                            className={`w-full text-left p-3 border-2 rounded-lg transition-all duration-200 ${
                              selectedAnswer === value
                                ? 'border-primary-500 bg-primary-50'
                                : !isUserTurn || hasAnswered
                                ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span>{value ? 'True' : 'False'}</span>
                              <div className="flex items-center space-x-1">
                                {teamAnswers.filter(a => a.answer === value).map((_, i) => (
                                  <div key={i} className="w-2 h-2 bg-primary-500 rounded-full" />
                                ))}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Team Consensus Status */}
                  {isUserTurn && (
                    <div className="mb-4">
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700 font-medium">Team Consensus</span>
                          <span className="text-blue-600">
                            {teamAnswers.length}/{currentTeamMembers.length} answered
                          </span>
                        </div>
                        {teamAnswers.length > 0 && !hasConsensus && (
                          <p className="text-blue-600 text-sm mt-1">
                            Team members have different answers. Coordinate to reach consensus!
                          </p>
                        )}
                        {hasConsensus && (
                          <div className="flex items-center space-x-2 mt-1">
                            <CheckCircle className="w-4 h-4 text-success-600" />
                            <span className="text-success-700 text-sm">Consensus reached!</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isUserTurn && !hasAnswered && selectedAnswer !== null && (
                    <button
                      onClick={submitAnswer}
                      className="btn-primary"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Submit Answer
                    </button>
                  )}

                  {hasAnswered && (
                    <div className="p-3 bg-success-50 border border-success-200 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <UserCheck className="w-5 h-5 text-success-600" />
                        <span className="text-success-700">Answer submitted! Waiting for team consensus...</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Trophy className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Question</h3>
                  <p className="text-gray-600">Loading next question...</p>
                </div>
              )}
            </div>
          </div>

          {/* Teams Panel */}
          <div className="space-y-4">
            {/* Team Scores */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Scores</h3>
              <div className="space-y-3">
                {Array.from({ length: currentRoom.num_teams }, (_, i) => i + 1).map(teamNum => {
                  const teamMembers = participants.filter(p => p.team_number === teamNum)
                  const score = currentRoom.team_scores[teamNum.toString()] || 0
                  const isCurrentTurn = teamNum === currentRoom.current_turn_team_id
                  
                  return (
                    <div
                      key={teamNum}
                      className={`p-3 rounded-lg border-2 ${
                        isCurrentTurn 
                          ? 'border-primary-500 bg-primary-50' 
                          : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                          {isCurrentTurn && <Play className="w-4 h-4 text-primary-600" />}
                          <span className="font-medium text-gray-900">Team {teamNum}</span>
                        </div>
                        <div className="text-lg font-bold text-primary-600">
                          {score}/{currentRoom.questions_per_team}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600">
                        {teamMembers.length} members
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Participants */}
            <div className="card">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                All Participants ({participants.length})
              </h3>
              
              <div className="space-y-2">
                {participants.map((participant) => {
                  const isCreator = participant.user_id === currentRoom.created_by
                  const hasAnsweredCurrent = currentAnswers[participant.user_id]
                  
                  return (
                    <div
                      key={participant.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center space-x-2">
                        {isCreator && <Crown className="w-4 h-4 text-yellow-500" />}
                        <span className="text-sm font-medium text-gray-900">
                          {participant.user_email}
                        </span>
                        <span className="text-xs bg-primary-100 text-primary-700 px-2 py-1 rounded">
                          Team {participant.team_number}
                        </span>
                      </div>
                      
                      {currentQuestion && participant.team_number === currentRoom.current_turn_team_id && (
                        <div className="flex items-center space-x-2">
                          {hasAnsweredCurrent ? (
                            <UserCheck className="w-4 h-4 text-success-600" />
                          ) : (
                            <div className="w-2 h-2 bg-gray-400 rounded-full" />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Room lobby
  if (currentRoom && currentRoom.room_status === 'lobby') {
    return (
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{currentRoom.name}</h1>
            <p className="text-gray-600">Room Code: <span className="font-mono font-bold">{currentRoom.code}</span></p>
          </div>
          <button onClick={leaveRoom} className="btn-secondary">
            Leave Room
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Game Settings */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Game Settings</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Number of Teams:</span>
                <span className="font-medium">{currentRoom.num_teams}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Questions per Team:</span>
                <span className="font-medium">{currentRoom.questions_per_team}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Time per Question:</span>
                <span className="font-medium">{currentRoom.time_per_question}s</span>
              </div>
            </div>

            {isRoomCreator && (
              <div className="mt-6">
                <button
                  onClick={startGame}
                  disabled={loading || participants.length < 2}
                  className="btn-primary w-full"
                >
                  {loading ? (
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Start Game
                </button>
                {participants.length < 2 && (
                  <p className="text-sm text-gray-500 mt-2 text-center">
                    Need at least 2 participants to start
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Teams */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Teams</h2>
            
            <div className="space-y-4">
              {Array.from({ length: currentRoom.num_teams }, (_, i) => i + 1).map(teamNum => {
                const teamMembers = participants.filter(p => p.team_number === teamNum)
                
                return (
                  <div key={teamNum} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-gray-900">Team {teamNum}</h3>
                      <span className="text-sm text-gray-500">
                        {teamMembers.length} members
                      </span>
                    </div>
                    
                    <div className="space-y-1">
                      {teamMembers.map(member => (
                        <div key={member.id} className="flex items-center space-x-2">
                          {member.user_id === currentRoom.created_by && (
                            <Crown className="w-4 h-4 text-yellow-500" />
                          )}
                          <span className="text-sm text-gray-700">{member.user_email}</span>
                        </div>
                      ))}
                      {teamMembers.length === 0 && (
                        <p className="text-sm text-gray-500 italic">No members yet</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Main lobby - room selection
  return (
    <div className="max-w-4xl mx-auto space-y-6 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Challenge</h1>
          <p className="text-gray-600">
            Collaborate with your team to answer Formula Student questions
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Create Room */}
        <div className="card">
          <div className="text-center">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <Plus className="w-6 h-6 text-primary-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Create Room</h2>
            <p className="text-gray-600 mb-4">
              Start a new team challenge session
            </p>
            
            {showCreateRoom ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="Enter room name"
                  className="input-field"
                />
                
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Teams</label>
                    <select
                      value={roomSettings.numTeams}
                      onChange={(e) => setRoomSettings(prev => ({ ...prev, numTeams: parseInt(e.target.value) }))}
                      className="input-field text-sm"
                    >
                      {[2, 3, 4, 5, 6, 7, 8].map(num => (
                        <option key={num} value={num}>{num}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Questions</label>
                    <select
                      value={roomSettings.questionsPerTeam}
                      onChange={(e) => setRoomSettings(prev => ({ ...prev, questionsPerTeam: parseInt(e.target.value) }))}
                      className="input-field text-sm"
                    >
                      {[5, 10, 15, 20].map(num => (
                        <option key={num} value={num}>{num}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Time (s)</label>
                    <select
                      value={roomSettings.timePerQuestion}
                      onChange={(e) => setRoomSettings(prev => ({ ...prev, timePerQuestion: parseInt(e.target.value) }))}
                      className="input-field text-sm"
                    >
                      {[30, 60, 90, 120].map(num => (
                        <option key={num} value={num}>{num}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    onClick={createRoom}
                    disabled={loading || !roomName.trim()}
                    className="btn-primary flex-1"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Create'}
                  </button>
                  <button
                    onClick={() => setShowCreateRoom(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateRoom(true)}
                className="btn-primary"
              >
                Create Room
              </button>
            )}
          </div>
        </div>

        {/* Join Room */}
        <div className="card">
          <div className="text-center">
            <div className="w-12 h-12 bg-success-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <LogIn className="w-6 h-6 text-success-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Join Room</h2>
            <p className="text-gray-600 mb-4">
              Enter a room code to join an existing session
            </p>
            
            {showJoinRoom ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Enter room code"
                  className="input-field font-mono text-center"
                  maxLength={6}
                />
                
                <div>
                  <label className="block text-sm text-gray-600 mb-2">Select Team</label>
                  <div className="flex space-x-2">
                    {[1, 2, 3, 4].map(teamNum => (
                      <button
                        key={teamNum}
                        onClick={() => setSelectedTeam(teamNum)}
                        className={`flex-1 py-2 px-3 rounded-lg border-2 transition-colors ${
                          selectedTeam === teamNum
                            ? 'border-primary-500 bg-primary-50 text-primary-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        Team {teamNum}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button
                    onClick={joinRoom}
                    disabled={loading || !roomCode.trim()}
                    className="btn-primary flex-1"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : 'Join'}
                  </button>
                  <button
                    onClick={() => setShowJoinRoom(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowJoinRoom(true)}
                className="btn-primary"
              >
                Join Room
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Active Rooms */}
      {rooms.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Rooms</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <div key={room.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-900">{room.name}</h3>
                  <div className="flex items-center space-x-1">
                    <Users className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-500">{room.num_teams}</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-2">
                  Code: <span className="font-mono font-bold">{room.code}</span>
                </p>
                <p className="text-xs text-gray-500 mb-3">
                  {room.questions_per_team} questions • {room.time_per_question}s per question
                </p>
                <button
                  onClick={() => {
                    setRoomCode(room.code)
                    setShowJoinRoom(true)
                  }}
                  className="btn-secondary w-full text-sm"
                >
                  Join Room
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}