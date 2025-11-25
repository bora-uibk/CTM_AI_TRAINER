import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { 
  Brain, 
  CircleCheck as CheckCircle, 
  Circle as XCircle, 
  RotateCcw, 
  Trophy, 
  Loader, 
  Clock,
  Play,
  Pause,
  Check,
  BookOpen,
  Square,
  CheckSquare,
  Type
} from 'lucide-react'

// Define the shape coming from your specific Gemini backend
interface QuizQuestion {
  id: string
  type: 'single_choice' | 'multi_choice' | 'input'
  question: string
  options: string[]
  correct_answer: string | number | number[] // Can be "12.34", 2, or [0, 2]
  explanation: string
  difficulty: string
}

export default function Quiz() {
  const { user } = useAuth()
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  
  // Answer state: can be single index, array of indices, or string text
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  
  const [showResult, setShowResult] = useState(false)
  const [score, setScore] = useState(0)
  const [answers, setAnswers] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  const [quizSettings, setQuizSettings] = useState({
    questionCount: 5,
    timeLimit: 10
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

  // ... (Keep useEffects for timer and document fetching same as before) ...
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
    if (saved) setSelectedDocuments(new Set(JSON.parse(saved)))
  }, [])

  const fetchDocuments = async () => {
    const { data } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
    
    const validDocs = (data || []).filter(doc => doc.content && doc.content.length > 50)
    setAvailableDocuments(validDocs)
  }

  const toggleDocumentSelection = (docId: string) => {
    const newSelected = new Set(selectedDocuments)
    if (newSelected.has(docId)) newSelected.delete(docId)
    else newSelected.add(docId)
    setSelectedDocuments(newSelected)
  }

  // ... (Keep generateQuiz same as before) ...
  const generateQuiz = async () => {
    if (selectedDocuments.size === 0) {
      alert("Please select at least one document.")
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
      resetQuiz(data.questions?.length || 0)
      setShowSettings(false)
    } catch (error) {
      console.error(error)
      alert("Failed to generate quiz.")
    } finally {
      setGenerating(false)
    }
  }

  const resetQuiz = (qCount = 0) => {
    setCurrentQuestionIndex(0)
    setSelectedAnswer(null)
    setShowResult(false)
    setScore(0)
    setQuizStarted(false)
    setQuizPaused(false)
    setAiFeedback('')
    setAnswers(new Array(qCount).fill(null))
  }

  const startQuiz = () => {
    setQuizStarted(true)
    setTimeRemaining(quizSettings.timeLimit * 60)
  }

  const handleTimeUp = () => {
    setQuizStarted(false)
    setShowResult(true)
    generateAIFeedback()
  }

  // --- LOGIC FOR DIFFERENT QUESTION TYPES ---

  const handleMultiChoiceSelect = (index: number) => {
    const current = (selectedAnswer as number[]) || []
    if (current.includes(index)) {
      setSelectedAnswer(current.filter(i => i !== index))
    } else {
      setSelectedAnswer([...current, index].sort())
    }
  }

  const checkAnswer = (userAns: any, correctAns: any, type: string) => {
    if (type === 'single_choice') {
      return Number(userAns) === Number(correctAns)
    }
    if (type === 'multi_choice') {
      // Compare arrays: sort both and check stringified versions
      const u = Array.isArray(userAns) ? userAns.sort().toString() : ''
      const c = Array.isArray(correctAns) ? correctAns.sort().toString() : ''
      return u === c
    }
    if (type === 'input') {
      // String comparison (trim whitespace, case insensitive)
      return String(userAns).trim().toLowerCase() === String(correctAns).trim().toLowerCase()
    }
    return false
  }

  const handleNext = () => {
    // Save Answer
    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = selectedAnswer
    setAnswers(newAnswers)

    // Calculate Score
    if (checkAnswer(selectedAnswer, currentQuestion.correct_answer, currentQuestion.type)) {
      setScore(prev => prev + 1)
    }

    if (isLastQuestion) {
      setQuizStarted(false)
      setShowResult(true)
      generateAIFeedback()
    } else {
      setCurrentQuestionIndex(prev => prev + 1)
      setSelectedAnswer(null) // Reset for next question
    }
  }

  const generateAIFeedback = async () => {
    // ... (Existing feedback logic) ...
    setLoadingFeedback(true)
    try {
        const { data, error } = await supabase.functions.invoke('generate-feedback', {
            body: { questions, answers, score, totalQuestions: questions.length, mode: 'individual' }
        })
        if (!error) setAiFeedback(data.feedback || "Quiz Completed.")
    } catch (e) { console.error(e) }
    setLoadingFeedback(false)
  }

  // --- UI RENDERING HELPERS ---

  const renderQuestionInput = () => {
    const { type, options } = currentQuestion

    // 1. Single Choice
    if (type === 'single_choice') {
      return (
        <div className="space-y-3">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => setSelectedAnswer(index)}
              className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 ${
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
                <span className="font-medium text-gray-900">{option}</span>
              </div>
            </button>
          ))}
        </div>
      )
    }

    // 2. Multi Choice
    if (type === 'multi_choice') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 mb-2">Select all that apply:</p>
          {options.map((option, index) => {
            const isSelected = (selectedAnswer as number[])?.includes(index)
            return (
              <button
                key={index}
                onClick={() => handleMultiChoiceSelect(index)}
                className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 ${
                  isSelected
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
                    : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center">
                  <div className={`mr-4 text-primary-600`}>
                    {isSelected ? <CheckSquare className="w-6 h-6" /> : <Square className="w-6 h-6 text-gray-300" />}
                  </div>
                  <span className="font-medium text-gray-900">{option}</span>
                </div>
              </button>
            )
          })}
        </div>
      )
    }

    // 3. Text Input (Calculations)
    if (type === 'input') {
      return (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your Calculation / Answer:</label>
          <div className="relative rounded-md shadow-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Type className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full rounded-md border-gray-300 pl-10 focus:border-primary-500 focus:ring-primary-500 py-3 text-lg border-2"
              placeholder="Type your answer (e.g., 12.34)"
              value={selectedAnswer || ''}
              onChange={(e) => setSelectedAnswer(e.target.value)}
            />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Enter the specific number or text required by the question.
          </p>
        </div>
      )
    }
  }

  // --- MAIN RENDER ---
  
  // 1. Settings
  if (showSettings) {
    return (
       // ... (Keep your existing Settings/Lobby UI exactly as it was, just ensure fetchDocuments is called) ...
       <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">New Quiz Session</h1>
        </div>
        {/* (Insert your existing settings UI here) */}
        <div className="card p-6">
             {/* Re-use your existing Document Selection UI here */}
             <h3 className="font-medium text-gray-900 mb-2">Select Documents</h3>
             <div className="border-2 border-gray-200 rounded-lg max-h-48 overflow-y-auto mb-4">
                 {availableDocuments.map((doc) => (
                     <div key={doc.id} onClick={() => toggleDocumentSelection(doc.id)} 
                          className={`p-3 cursor-pointer ${selectedDocuments.has(doc.id) ? 'bg-primary-50' : 'bg-white'}`}>
                        {doc.name}
                     </div>
                 ))}
             </div>
             <button onClick={generateQuiz} disabled={generating || selectedDocuments.size === 0} className="btn-primary w-full py-3">
                 {generating ? <Loader className="animate-spin inline mr-2"/> : "Generate Quiz"}
             </button>
        </div>
       </div>
    )
  }

  // 2. Loading
  if (generating) return <div className="text-center py-20"><Loader className="animate-spin mx-auto w-10 h-10 text-primary-600"/> Generating...</div>

  // 3. Ready to Start
  if (!quizStarted && !showResult) {
    return (
      <div className="max-w-2xl mx-auto px-4 text-center pt-12">
        <div className="card py-12">
          <Trophy className="w-16 h-16 text-primary-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900">Quiz Ready!</h2>
          <button onClick={startQuiz} className="btn-primary px-8 py-3 mt-6 text-lg">Start Now</button>
        </div>
      </div>
    )
  }

  // 4. Results
  if (showResult) {
    return (
      <div className="max-w-3xl mx-auto px-4 pb-12">
        <div className="card text-center mb-6 p-8">
          <h2 className="text-3xl font-bold mb-2">Score: {score} / {questions.length}</h2>
          <div className="bg-blue-50 p-4 rounded text-left text-sm text-blue-800 mt-4">
             <strong>AI Feedback:</strong> {loadingFeedback ? "Analyzing..." : aiFeedback}
          </div>
        </div>

        <div className="space-y-4">
          {questions.map((q, i) => {
            const userAns = answers[i]
            const isCorrect = checkAnswer(userAns, q.correct_answer, q.type)
            
            return (
              <div key={q.id} className={`p-4 border-2 rounded-lg ${isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                 <p className="font-bold text-gray-900 mb-2">{i + 1}. {q.question}</p>
                 
                 {/* Display based on type */}
                 {q.type === 'input' ? (
                    <div className="text-sm">
                        <p>Your Answer: <span className="font-mono font-bold">{userAns}</span></p>
                        <p>Correct Answer: <span className="font-mono font-bold">{q.correct_answer}</span></p>
                    </div>
                 ) : (
                    <div className="space-y-1">
                        {q.options.map((opt, optIdx) => {
                            // Logic to determine highlighting
                            let highlight = ''
                            // Logic varies for multi vs single, simplified here for readability:
                            const isUserSelected = Array.isArray(userAns) ? userAns.includes(optIdx) : userAns === optIdx
                            const isActuallyCorrect = Array.isArray(q.correct_answer) 
                                ? (q.correct_answer as number[]).includes(optIdx) 
                                : q.correct_answer === optIdx

                            if (isActuallyCorrect) highlight = 'text-green-700 font-bold'
                            else if (isUserSelected && !isActuallyCorrect) highlight = 'text-red-600 line-through'

                            return (
                                <div key={optIdx} className={`text-sm ${highlight}`}>
                                    {String.fromCharCode(65+optIdx)}. {opt}
                                    {isUserSelected && " (You)"}
                                    {isActuallyCorrect && " ✓"}
                                </div>
                            )
                        })}
                    </div>
                 )}
                 <div className="mt-3 text-xs text-gray-500 border-t pt-2 border-gray-300">
                    Explanation: {q.explanation}
                 </div>
              </div>
            )
          })}
        </div>
        <button onClick={() => setShowSettings(true)} className="btn-primary w-full mt-8 py-3">Start New Quiz</button>
      </div>
    )
  }

  // 5. Active Quiz
  return (
    <div className="max-w-2xl mx-auto px-4 pt-6">
      <div className="flex justify-between mb-4">
        <span className="font-bold text-gray-500">Question {currentQuestionIndex + 1}/{questions.length}</span>
        {quizSettings.timeLimit > 0 && (
             <span className={`${timeRemaining < 60 ? 'text-red-600' : 'text-gray-700'} font-mono font-bold`}>
                 {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
             </span>
        )}
      </div>

      <div className="card p-6">
         <div className="mb-2">
            <span className="text-xs bg-gray-100 px-2 py-1 rounded uppercase font-bold tracking-wider text-gray-600">
                {currentQuestion.type.replace('_', ' ')}
            </span>
         </div>
         <h2 className="text-xl font-bold text-gray-900 mb-6">{currentQuestion.question}</h2>
         
         {/* Dynamic Input Rendering */}
         {renderQuestionInput()}

         <div className="mt-8 flex justify-end">
            <button 
                onClick={handleNext} 
                disabled={selectedAnswer === null || (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) || (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '')}
                className="btn-primary px-6 py-2 disabled:opacity-50"
            >
                {isLastQuestion ? "Submit" : "Next"}
            </button>
         </div>
      </div>
    </div>
  )
}