import React, { useState, useEffect } from 'react'
import { supabase, QuizQuestion } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Brain, 
  CircleCheck as CheckCircle, 
  Circle as XCircle, 
  RotateCcw, 
  Trophy, 
  Loader, 
  CircleAlert as AlertCircle,
  Clock,
  Settings,
  Play,
  Pause,
  FileText,
  Check
} from 'lucide-react'

export default function Quiz() {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<string | number | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [score, setScore] = useState(0)
  const [answers, setAnswers] = useState<(string | number | null)[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  const [quizSettings, setQuizSettings] = useState({
    questionCount: 5,
    timeLimit: 10 // in minutes
  })
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [quizStarted, setQuizStarted] = useState(false)
  const [quizPaused, setQuizPaused] = useState(false)
  const [aiFeedback, setAiFeedback] = useState('')
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [showDocumentSelector, setShowDocumentSelector] = useState(false)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [availableDocuments, setAvailableDocuments] = useState<any[]>([])

  const currentQuestion = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1

  useEffect(() => {
    let interval: NodeJS.Timeout
    if (quizStarted && !quizPaused && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            // Time's up - end quiz
            handleTimeUp()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [quizStarted, quizPaused, timeRemaining])

  useEffect(() => {
    fetchDocuments()
    // Load selected documents from localStorage
    const saved = localStorage.getItem('selectedDocuments')
    if (saved) {
      setSelectedDocuments(new Set(JSON.parse(saved)))
    }
  }, [])

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Filter to only show documents with valid content
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

  const handleTimeUp = () => {
    setQuizStarted(false)
    setShowResult(true)
    generateAIFeedback()
  }

  const generateQuiz = async () => {
    setGenerating(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-quiz', {
        body: { 
          count: quizSettings.questionCount,
          selectedDocuments: Array.from(selectedDocuments)
        }
      })

      if (error) throw error

      setQuestions(data.questions || [])
      setAnswers(new Array(data.questions?.length || 0).fill(null))
      resetQuiz()
      setShowSettings(false)
    } catch (error) {
      console.error('Error generating quiz:', error)
      // Fallback questions
      const fallbackQuestions: QuizQuestion[] = [
        {
          id: '1',
          type: 'multiple_choice',
          question: 'What is the maximum engine displacement allowed in Formula Student?',
          options: ['610cc', '650cc', '710cc', '750cc'],
          correct_answer: 0,
          explanation: 'The maximum engine displacement is 610cc according to Formula Student rules.',
          difficulty: 'medium'
        },
        {
          id: '2',
          type: 'true_false',
          question: 'Formula Student cars must have a functioning brake system on all four wheels.',
          correct_answer: true,
          explanation: 'All Formula Student cars must have brakes on all four wheels for safety.',
          difficulty: 'easy'
        }
      ]
      setQuestions(fallbackQuestions)
      setAnswers(new Array(fallbackQuestions.length).fill(null))
      resetQuiz()
      setShowSettings(false)
    } finally {
      setGenerating(false)
    }
  }

  const resetQuiz = () => {
    setCurrentQuestionIndex(0)
    setSelectedAnswer(null)
    setShowResult(false)
    setScore(0)
    setQuizStarted(false)
    setQuizPaused(false)
    setTimeRemaining(0)
    setAiFeedback('')
    setAnswers(new Array(questions.length).fill(null))
  }

  const startQuiz = () => {
    setQuizStarted(true)
    setTimeRemaining(quizSettings.timeLimit * 60) // Convert minutes to seconds
  }

  const pauseQuiz = () => {
    setQuizPaused(!quizPaused)
  }

  const handleAnswerSelect = (answer: string | number) => {
    setSelectedAnswer(answer)
  }

  const handleNext = () => {
    if (selectedAnswer === null) return

    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = selectedAnswer
    setAnswers(newAnswers)

    if (selectedAnswer === currentQuestion.correct_answer) {
      setScore(score + 1)
    }

    if (isLastQuestion) {
      setQuizStarted(false)
      setShowResult(true)
      generateAIFeedback()
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
      setSelectedAnswer(null)
    }
  }

  const generateAIFeedback = async () => {
    setLoadingFeedback(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-feedback', {
        body: {
          questions,
          answers,
          score,
          totalQuestions: questions.length
        }
      })

      if (error) throw error
      setAiFeedback(data.feedback || '')
    } catch (error) {
      console.error('Error generating feedback:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('fetch')) {
        setAiFeedback('Unable to connect to the feedback service. Please check your internet connection and try again.')
      } else {
        setAiFeedback(`Unable to generate personalized feedback: ${errorMessage}`)
      }
    } finally {
      setLoadingFeedback(false)
    }
  }

  const handleRestart = () => {
    setShowSettings(true)
    resetQuiz()
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getScoreColor = () => {
    const percentage = (score / questions.length) * 100
    if (percentage >= 80) return 'text-success-600'
    if (percentage >= 60) return 'text-yellow-600'
    return 'text-danger-600'
  }

  const getScoreMessage = () => {
    const percentage = (score / questions.length) * 100
    if (percentage >= 80) return 'Excellent work! You\'re well prepared.'
    if (percentage >= 60) return 'Good job! Keep studying to improve.'
    return 'Keep practicing! Review the materials and try again.'
  }

  // Quiz Settings Screen
  if (showSettings) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Quiz Settings</h1>
          <p className="text-gray-600 mt-1">
            Configure your Formula Student quiz
          </p>
          <div className="flex items-center justify-between mt-2">
            <p className="text-sm text-gray-500">
              {selectedDocuments.size > 0 
                ? `Using ${selectedDocuments.size} selected document${selectedDocuments.size !== 1 ? 's' : ''}`
                : 'Using all available documents'
              }
            </p>
            <button
              onClick={() => setShowDocumentSelector(!showDocumentSelector)}
              className="flex items-center space-x-1 text-sm text-primary-600 hover:text-primary-700"
            >
              <Settings className="w-4 h-4" />
              <span>Select Documents</span>
            </button>
          </div>
        </div>

        {/* Document Selector */}
        {showDocumentSelector && (
          <div className="card mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Documents for Quiz</h3>
            {availableDocuments.length === 0 ? (
              <p className="text-gray-600">No valid documents available. Please upload and process documents first.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availableDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => toggleDocumentSelection(doc.id)}
                    className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                      selectedDocuments.has(doc.id)
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                      selectedDocuments.has(doc.id)
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-gray-300'
                    }`}>
                      {selectedDocuments.has(doc.id) && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <FileText className="w-5 h-5 text-primary-600" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{doc.name}</p>
                      <p className="text-sm text-gray-500">{doc.content.length} characters</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowDocumentSelector(false)}
                className="btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Number of Questions
              </label>
              <select
                value={quizSettings.questionCount}
                onChange={(e) => setQuizSettings(prev => ({ ...prev, questionCount: parseInt(e.target.value) }))}
                className="input-field"
              >
                <option value={5}>5 Questions</option>
                <option value={10}>10 Questions</option>
                <option value={15}>15 Questions</option>
                <option value={20}>20 Questions</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Time Limit (Total Quiz Duration)
              </label>
              <select
                value={quizSettings.timeLimit}
                onChange={(e) => setQuizSettings(prev => ({ ...prev, timeLimit: parseInt(e.target.value) }))}
                className="input-field"
              >
                <option value={5}>5 Minutes</option>
                <option value={10}>10 Minutes</option>
                <option value={15}>15 Minutes</option>
                <option value={20}>20 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={0}>No Time Limit</option>
              </select>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-2">Quiz Preview</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• {quizSettings.questionCount} AI-generated questions</li>
                <li>• {quizSettings.timeLimit > 0 ? `${quizSettings.timeLimit} minutes total` : 'No time limit'}</li>
                <li>• Mix of multiple choice and true/false questions</li>
                <li>• Personalized AI feedback based on your performance</li>
              </ul>
            </div>

            <button
              onClick={generateQuiz}
              disabled={generating}
              className="btn-primary w-full"
            >
              {generating ? (
                <span className="flex items-center justify-center space-x-2">
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Generating Quiz...</span>
                </span>
              ) : (
                <span className="flex items-center justify-center space-x-2">
                  <Brain className="w-4 h-4" />
                  <span>Generate Quiz</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (generating) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
          <p className="text-gray-600">Generating quiz questions with AI...</p>
        </div>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Questions Available</h2>
        <p className="text-gray-600 mb-4">
          Please upload some training documents first to generate quiz questions.
        </p>
        <button onClick={() => setShowSettings(true)} className="btn-primary">
          Configure Quiz
        </button>
      </div>
    )
  }

  if (showResult) {
    return (
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Quiz Results</h1>
        </div>

        <div className="card text-center">
          <div className="mb-6">
            <Trophy className={`w-16 h-16 mx-auto mb-4 ${getScoreColor()}`} />
            <h2 className={`text-3xl font-bold mb-2 ${getScoreColor()}`}>
              {score} / {questions.length}
            </h2>
            <p className="text-xl text-gray-600 mb-4">
              {Math.round((score / questions.length) * 100)}% Correct
            </p>
            <p className="text-gray-600">{getScoreMessage()}</p>
          </div>

          {/* AI Feedback Section */}
          <div className="mb-8 text-left">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">
              AI Performance Analysis
            </h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              {loadingFeedback ? (
                <div className="flex items-center justify-center py-4">
                  <Loader className="w-5 h-5 animate-spin text-primary-600 mr-2" />
                  <span className="text-gray-600">Analyzing your performance...</span>
                </div>
              ) : (
                <p className="text-gray-700 whitespace-pre-wrap">{aiFeedback}</p>
              )}
            </div>
          </div>

          <div className="space-y-4 mb-8">
            {questions.map((question, index) => {
              const userAnswer = answers[index]
              const isCorrect = userAnswer === question.correct_answer
              
              return (
                <div key={question.id} className="text-left p-3 sm:p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-start space-x-3">
                    {isCorrect ? (
                      <CheckCircle className="w-5 h-5 text-success-600 mt-0.5" />
                    ) : (
                      <XCircle className="w-5 h-5 text-danger-600 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 mb-2 text-sm sm:text-base">
                        {index + 1}. {question.question}
                      </p>
                      
                      {question.type === 'multiple_choice' && question.options && (
                        <div className="space-y-1 text-sm">
                          <p className="text-gray-600">
                            Your answer: {question.options[userAnswer as number] || 'No answer'}
                          </p>
                          <p className="text-gray-600">
                            Correct answer: {question.options[question.correct_answer as number]}
                          </p>
                        </div>
                      )}
                      
                      {question.type === 'true_false' && (
                        <div className="space-y-1 text-sm">
                          <p className="text-gray-600">
                            Your answer: {userAnswer?.toString() || 'No answer'}
                          </p>
                          <p className="text-gray-600">
                            Correct answer: {question.correct_answer.toString()}
                          </p>
                        </div>
                      )}
                      
                      <p className="text-sm text-gray-500 mt-2">
                        {question.explanation}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 justify-center">
            <button onClick={handleRestart} className="btn-secondary">
              <Settings className="w-4 h-4 mr-2" />
              New Quiz
            </button>
            <button onClick={() => setShowSettings(true)} className="btn-primary">
              <Brain className="w-4 h-4 mr-2" />
              Configure Quiz
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Quiz not started yet
  if (!quizStarted) {
    return (
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Ready to Start Quiz</h1>
          <p className="text-gray-600 mt-1">
            {questions.length} questions • {quizSettings.timeLimit > 0 ? `${quizSettings.timeLimit} minutes` : 'No time limit'}
          </p>
        </div>

        <div className="card text-center">
          <div className="mb-6">
            <Brain className="w-16 h-16 text-primary-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Formula Student Quiz
            </h2>
            <p className="text-gray-600">
              Test your knowledge with AI-generated questions based on your uploaded documents.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 justify-center">
            <button onClick={() => setShowSettings(true)} className="btn-secondary">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </button>
            <button onClick={startQuiz} className="btn-primary">
              <Play className="w-4 h-4 mr-2" />
              Start Quiz
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Self Quiz</h1>
          <p className="text-gray-600 mt-1">
            Test your Formula Student knowledge
          </p>
        </div>
        <div className="text-right">
          <div className="flex flex-col sm:flex-row items-end sm:items-center space-y-2 sm:space-y-0 sm:space-x-4">
            {quizSettings.timeLimit > 0 && (
              <div className="flex items-center space-x-2 justify-end sm:justify-start">
                <Clock className={`w-5 h-5 ${timeRemaining < 60 ? 'text-danger-600' : 'text-gray-600'}`} />
                <span className={`font-mono text-base sm:text-lg ${timeRemaining < 60 ? 'text-danger-600' : 'text-gray-900'}`}>
                  {formatTime(timeRemaining)}
                </span>
                <button
                  onClick={pauseQuiz}
                  className="p-1 text-gray-600 hover:text-primary-600 rounded"
                >
                  <Pause className="w-4 h-4" />
                </button>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">
                Question {currentQuestionIndex + 1} of {questions.length}
              </p>
              <div className="w-24 sm:w-32 bg-gray-200 rounded-full h-2 mt-1">
                <div 
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {quizPaused && (
        <div className="card mb-6 text-center">
          <div className="py-4">
            <Pause className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-600">Quiz Paused</p>
            <button onClick={pauseQuiz} className="btn-primary mt-2">
              Resume Quiz
            </button>
          </div>
        </div>
      )}

      <div className={`card ${quizPaused ? 'opacity-50' : ''}`}>
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              currentQuestion.difficulty === 'easy' ? 'bg-success-100 text-success-700' :
              currentQuestion.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-700' :
              'bg-danger-100 text-danger-700'
            }`}>
              {currentQuestion.difficulty.toUpperCase()}
            </span>
            <span className="text-sm text-gray-500 capitalize">
              {currentQuestion.type.replace('_', ' ')}
            </span>
          </div>
          
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-6">
            {currentQuestion.question}
          </h2>
        </div>

        <div className="space-y-3 mb-8">
          {currentQuestion.type === 'multiple_choice' && currentQuestion.options && (
            currentQuestion.options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleAnswerSelect(index)}
                disabled={quizPaused}
                className={`w-full text-left p-4 border-2 rounded-lg transition-all duration-200 ${
                  selectedAnswer === index
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                } ${quizPaused ? 'cursor-not-allowed' : ''}`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    selectedAnswer === index
                      ? 'border-primary-500 bg-primary-500'
                      : 'border-gray-300'
                  }`}>
                    {selectedAnswer === index && (
                      <div className="w-2 h-2 bg-white rounded-full mx-auto mt-0.5" />
                    )}
                  </div>
                  <span className="font-medium text-sm sm:text-base">
                    {String.fromCharCode(65 + index)}. {option}
                  </span>
                </div>
              </button>
            ))
          )}

          {currentQuestion.type === 'true_false' && (
            <>
              <button
                onClick={() => handleAnswerSelect(true)}
                disabled={quizPaused}
                className={`w-full text-left p-4 border-2 rounded-lg transition-all duration-200 ${
                  selectedAnswer === true
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                } ${quizPaused ? 'cursor-not-allowed' : ''}`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    selectedAnswer === true
                      ? 'border-primary-500 bg-primary-500'
                      : 'border-gray-300'
                  }`}>
                    {selectedAnswer === true && (
                      <div className="w-2 h-2 bg-white rounded-full mx-auto mt-0.5" />
                    )}
                  </div>
                  <span className="font-medium text-sm sm:text-base">True</span>
                </div>
              </button>
              
              <button
                onClick={() => handleAnswerSelect(false)}
                disabled={quizPaused}
                className={`w-full text-left p-4 border-2 rounded-lg transition-all duration-200 ${
                  selectedAnswer === false
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                } ${quizPaused ? 'cursor-not-allowed' : ''}`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    selectedAnswer === false
                      ? 'border-primary-500 bg-primary-500'
                      : 'border-gray-300'
                  }`}>
                    {selectedAnswer === false && (
                      <div className="w-2 h-2 bg-white rounded-full mx-auto mt-0.5" />
                    )}
                  </div>
                  <span className="font-medium text-sm sm:text-base">False</span>
                </div>
              </button>
            </>
          )}
        </div>

        <div className="flex flex-col sm:flex-row justify-between space-y-2 sm:space-y-0 sm:space-x-4">
          <button
            onClick={handleRestart}
            className="btn-secondary w-full sm:w-auto"
            disabled={quizPaused}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            New Quiz
          </button>
          
          <button
            onClick={handleNext}
            disabled={selectedAnswer === null || selectedAnswer === '' || quizPaused}
            className="btn-primary w-full sm:w-auto"
          >
            {isLastQuestion ? 'Finish Quiz' : 'Next Question'}
          </button>
        </div>
      </div>
    </div>
  )
}