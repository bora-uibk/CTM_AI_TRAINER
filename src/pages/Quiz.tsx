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
  Check,
  BookOpen
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
      
      // Filter valid docs
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
    if (selectedDocuments.size === 0) {
      alert("Please select at least one document (e.g., Rules or Past Quizzes) to generate questions from.")
      return
    }

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
      alert("Failed to generate quiz. Please ensure your documents are processed correctly.")
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
    setTimeRemaining(quizSettings.timeLimit * 60)
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
      // Prepare data for the feedback function
      // We send a simple summary since the complex Team Feedback function 
      // might expect a different format.
      const { data, error } = await supabase.functions.invoke('generate-feedback', {
        body: {
          questions,
          answers,
          score,
          totalQuestions: questions.length,
          mode: 'individual' // Signal that this is an individual quiz
        }
      })

      if (error) throw error
      // Handle both structure types (Team vs Individual feedback)
      const feedbackText = data.detailed_analysis || data.feedback || data.summary || "Quiz completed."
      setAiFeedback(feedbackText)
      
    } catch (error) {
      console.error('Error generating feedback:', error)
      setAiFeedback("Great job completing the quiz! (AI feedback unavailable at the moment)")
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

  // --- QUIZ SETTINGS (LOBBY) ---
  if (showSettings) {
    return (
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">New Quiz Session</h1>
          <p className="text-gray-600 mt-1">
            Configure your training session
          </p>
        </div>

        <div className="card">
          <div className="space-y-6">
            
            {/* 1. Document Selection */}
            <div>
              <div className="flex items-center space-x-2 mb-3">
                <BookOpen className="w-5 h-5 text-primary-600" />
                <h3 className="font-medium text-gray-900">Select Knowledge Base</h3>
              </div>
              
              <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
                {availableDocuments.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 bg-gray-50">
                    No documents found. Go to "Documents" to upload Rulebooks or Past Quizzes.
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
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${selectedDocuments.has(doc.id) ? 'text-primary-900' : 'text-gray-700'}`}>
                            {doc.name}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="p-2 bg-gray-100 text-xs text-gray-500 border-t border-gray-200 text-center">
                  Tip: Select <b>both</b> the "Rulebook" and "Past Quizzes" for the best results.
                </div>
              </div>
            </div>

            {/* 2. Quiz Parameters */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Questions
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
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Time Limit
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
                  <option value={0}>No Limit</option>
                </select>
              </div>
            </div>

            {/* 3. Action Button */}
            <button
              onClick={generateQuiz}
              disabled={generating || selectedDocuments.size === 0}
              className="btn-primary w-full py-3 text-lg shadow-sm"
            >
              {generating ? (
                <span className="flex items-center justify-center space-x-2">
                  <Loader className="w-5 h-5 animate-spin" />
                  <span>Analyzing Documents...</span>
                </span>
              ) : (
                <span className="flex items-center justify-center space-x-2">
                  <Brain className="w-5 h-5" />
                  <span>Generate Quiz</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- GENERATING STATE ---
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-64 px-4 text-center">
        <Loader className="w-10 h-10 animate-spin text-primary-600 mb-4" />
        <h2 className="text-lg font-semibold text-gray-900">Constructing Quiz...</h2>
        <p className="text-gray-500 mt-2 max-w-md">
          The AI is reading your selected documents, extracting rules, and creating new questions based on past examples.
        </p>
      </div>
    )
  }

  // --- QUIZ START SCREEN (READY) ---
  if (!quizStarted && !showResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 text-center">
        <div className="card py-12">
          <div className="mb-6 inline-flex p-4 bg-primary-50 rounded-full">
            <Trophy className="w-12 h-12 text-primary-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Quiz Ready!
          </h2>
          <p className="text-gray-600 mb-8">
            You have {questions.length} questions. Good luck!
          </p>
          <button onClick={startQuiz} className="btn-primary px-8 py-3 text-lg">
            Start Now
          </button>
          <div className="mt-4">
             <button onClick={() => setShowSettings(true)} className="text-sm text-gray-500 hover:text-gray-900">
               Back to Settings
             </button>
          </div>
        </div>
      </div>
    )
  }

  // --- RESULTS SCREEN ---
  if (showResult) {
    return (
      <div className="max-w-3xl mx-auto px-4 pb-12">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Quiz Results</h1>
        </div>

        <div className="card text-center mb-6">
          <div className="mb-6">
            <Trophy className={`w-16 h-16 mx-auto mb-4 ${getScoreColor()}`} />
            <h2 className={`text-4xl font-bold mb-2 ${getScoreColor()}`}>
              {score} / {questions.length}
            </h2>
            <p className="text-gray-600">
              {Math.round((score / questions.length) * 100)}% Correct
            </p>
          </div>

          {/* AI Feedback */}
          <div className="bg-blue-50 p-5 rounded-lg text-left border border-blue-100">
            <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide mb-2 flex items-center">
              <Brain className="w-4 h-4 mr-2" />
              AI Coach Feedback
            </h3>
            {loadingFeedback ? (
              <div className="flex items-center py-2 text-blue-700">
                <Loader className="w-4 h-4 animate-spin mr-2" />
                Analyzing your answers...
              </div>
            ) : (
              <div className="prose prose-sm text-blue-800 whitespace-pre-wrap">
                {aiFeedback}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900 px-1">Review Answers</h3>
          {questions.map((question, index) => {
            const userAnswer = answers[index]
            const isCorrect = userAnswer === question.correct_answer
            
            return (
              <div key={question.id} className={`p-4 border-2 rounded-lg ${isCorrect ? 'border-success-100 bg-success-50/30' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-1 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isCorrect ? 'bg-success-100 text-success-600' : 'bg-danger-100 text-danger-600'}`}>
                    {isCorrect ? <Check className="w-4 h-4" /> : <span className="text-xs font-bold">✕</span>}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 mb-3">
                      {index + 1}. {question.question}
                    </p>
                    
                    <div className="space-y-2 mb-4">
                      {question.options?.map((opt, i) => (
                        <div key={i} className={`p-2 rounded text-sm flex justify-between ${
                          i === question.correct_answer 
                            ? 'bg-success-100 text-success-900 font-medium ring-1 ring-success-200' 
                            : i === userAnswer 
                              ? 'bg-danger-100 text-danger-900 ring-1 ring-danger-200'
                              : 'bg-gray-50 text-gray-600'
                        }`}>
                          <span>{String.fromCharCode(65 + i)}. {opt}</span>
                          {i === question.correct_answer && <Check className="w-4 h-4 text-success-600" />}
                        </div>
                      ))}
                    </div>
                    
                    <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                      <span className="font-semibold text-gray-900">Explanation: </span>
                      {question.explanation}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <button onClick={handleRestart} className="btn-primary shadow-lg px-8">
            Start New Quiz
          </button>
        </div>
      </div>
    )
  }

  // --- ACTIVE QUIZ INTERFACE ---
  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Question {currentQuestionIndex + 1} of {questions.length}</span>
          <div className="flex items-center space-x-2 mt-1">
             <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
              currentQuestion.difficulty === 'easy' ? 'bg-green-100 text-green-800' :
              currentQuestion.difficulty === 'medium' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {currentQuestion.difficulty}
            </span>
          </div>
        </div>

        {quizSettings.timeLimit > 0 && (
          <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg ${timeRemaining < 60 ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-700'}`}>
            <Clock className="w-4 h-4" />
            <span className="font-mono font-bold">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>

      <div className="w-full bg-gray-200 rounded-full h-1.5 mb-8">
        <div 
          className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${((currentQuestionIndex) / questions.length) * 100}%` }}
        />
      </div>

      <div className="card">
        <h2 className="text-xl font-bold text-gray-900 mb-8 leading-relaxed">
          {currentQuestion.question}
        </h2>

        <div className="space-y-3">
          {currentQuestion.options?.map((option, index) => (
            <button
              key={index}
              onClick={() => handleAnswerSelect(index)}
              className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 hover:shadow-md ${
                selectedAnswer === index
                  ? 'border-primary-600 bg-primary-50 shadow-sm'
                  : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center">
                <div className={`flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center mr-4 ${
                   selectedAnswer === index ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 text-gray-500'
                }`}>
                  {String.fromCharCode(65 + index)}
                </div>
                <span className={`font-medium ${selectedAnswer === index ? 'text-primary-900' : 'text-gray-700'}`}>
                  {option}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleNext}
            disabled={selectedAnswer === null}
            className="btn-primary px-8 py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLastQuestion ? 'Submit Quiz' : 'Next Question'}
          </button>
        </div>
      </div>
    </div>
  )
}