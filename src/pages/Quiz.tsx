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
  CircleAlert as AlertCircle, 
  Clock, 
  Settings, 
  Play, 
  Pause, 
  FileText, 
  Check, 
  BookOpen, 
  Square, 
  SquareCheck as CheckSquare, 
  Type, 
  Hash,
  Database,
  Filter
} from 'lucide-react'

// 1. Define Question Interface
interface QuizQuestion {
  id: string
  type: 'single_choice' | 'multi_choice' | 'input'
  question: string
  options: string[] 
  correct_answer: string | number | number[] 
  explanation: string
  difficulty: string
  // New field for images
  image_path?: string | null
}

export default function Quiz() {
  const { user } = useAuth()
  
  // 2. State
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  const [showResult, setShowResult] = useState(false)
  const [score, setScore] = useState(0)
  const [answers, setAnswers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  
  // --- NEW: Quiz Mode State ---
  const [quizMode, setQuizMode] = useState<'official' | 'ai'>('official')
  
  // Settings State
  const [quizSettings, setQuizSettings] = useState({
    questionCount: 5,
    timeLimit: 10, // in minutes
    // New Filters for Official Mode
    yearFilter: 'all',
    sourceFilter: 'all'
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

  // --- Effects ---
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
    // Only fetch docs if we might need them (AI mode or initial load)
    fetchDocuments()
    const saved = localStorage.getItem('selectedDocuments')
    if (saved) setSelectedDocuments(new Set(JSON.parse(saved)))
  }, [])

  // --- Helpers ---
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
    if (newSelected.has(docId)) newSelected.delete(docId)
    else newSelected.add(docId)
    setSelectedDocuments(newSelected)
    localStorage.setItem('selectedDocuments', JSON.stringify(Array.from(newSelected)))
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
    if (percentage >= 80) return 'text-green-600'
    if (percentage >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  // --- Logic: Generate & Run Quiz ---
  const generateQuiz = async () => {
    // Basic validation
    if (quizSettings.questionCount < 1) {
        alert("Please request at least 1 question.");
        return;
    }

    setGenerating(true)
    setQuestions([])

    try {
      if (quizMode === 'ai') {
        // --- EXISTING AI LOGIC ---
        if (selectedDocuments.size === 0) {
          alert("Please select at least one document.")
          setGenerating(false)
          return
        }

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

      } else {
        // --- NEW OFFICIAL QUESTION BANK LOGIC ---
        let query = supabase.from('question_bank').select('*')
        
        // Apply Filters
        if (quizSettings.yearFilter !== 'all') {
            query = query.eq('year', parseInt(quizSettings.yearFilter))
        }
        if (quizSettings.sourceFilter !== 'all') {
            query = query.eq('source_event', quizSettings.sourceFilter)
        }

        // Fetch random questions
        // Note: .order('random') is not standard Supabase syntax but works if you enabled the pg extension or just use simple fetching
        // For standard Supabase, we can't easily do 'random' efficiently on big tables without RPC. 
        // We will fetch and then shuffle in JS for now (limit is small).
        const { data, error } = await query.limit(50) // Fetch a pool to shuffle from

        if (error) throw error
        
        if (!data || data.length === 0) {
            alert("No questions found matching these filters. Try selecting 'All Years'.")
            setGenerating(false)
            return
        }

        // Shuffle and Slice
        const shuffled = data.sort(() => 0.5 - Math.random()).slice(0, quizSettings.questionCount)

        // Map DB Schema to QuizQuestion Interface
        const mappedQuestions: QuizQuestion[] = shuffled.map((q: any) => {
           let rawOptions = q.options;
           // Handle potential double-encoded JSON or direct object
           if (typeof rawOptions === 'string') {
               try { rawOptions = JSON.parse(rawOptions) } catch(e) {}
           }
           
           // Options for UI (Text array)
           const opts = Array.isArray(rawOptions) ? rawOptions.map((o: any) => o.text) : [];

           // Calculate Correct Answer
           let correctVal: any = null;

           if (q.type === 'single-choice') {
               // Index of true
               correctVal = Array.isArray(rawOptions) ? rawOptions.findIndex((o: any) => o.is_correct === true) : 0;
           } else if (q.type === 'multi_choice') {
               // Array of indices
               correctVal = Array.isArray(rawOptions) 
                   ? rawOptions.map((o: any, idx: number) => o.is_correct ? idx : -1).filter((i:number) => i !== -1)
                   : [];
           } else {
               // Input: The correct text string
               const correctObj = Array.isArray(rawOptions) ? rawOptions.find((o: any) => o.is_correct === true) : null;
               correctVal = correctObj ? correctObj.text : "";
           }

           // Image Handling
           let imgPath = null;
           let rawImages = q.images;
           if (typeof rawImages === 'string') {
               try { rawImages = JSON.parse(rawImages) } catch(e) {}
           }
           if (Array.isArray(rawImages) && rawImages.length > 0) {
               imgPath = rawImages[0].path;
           }

           return {
               id: q.id,
               type: (q.type === 'input-range' ? 'input' : q.type) as any,
               question: q.question_text,
               options: opts,
               correct_answer: correctVal,
               explanation: q.explanation || "Official Solution",
               difficulty: 'Hard',
               image_path: imgPath
           }
        })

        setQuestions(mappedQuestions)
        resetQuiz(mappedQuestions.length)
        setShowSettings(false)
      }

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
    setTimeRemaining(0)
    setAiFeedback('')
    setAnswers(new Array(qCount > 0 ? qCount : questions.length).fill(null))
  }

  const startQuiz = () => {
    setQuizStarted(true)
    if (quizSettings.timeLimit > 0) {
        setTimeRemaining(quizSettings.timeLimit * 60)
    } else {
        setTimeRemaining(99999) // Effectively infinite
    }
  }

  const handleTimeUp = () => {
    setQuizStarted(false)
    setShowResult(true)
    generateAIFeedback()
  }

  // --- Logic: Scoring ---
  const handleMultiChoiceSelect = (index: number) => {
    const current = (selectedAnswer as number[]) || []
    if (current.includes(index)) {
      setSelectedAnswer(current.filter(i => i !== index))
    } else {
      setSelectedAnswer([...current, index].sort())
    }
  }

  // --- UPDATED CHECK ANSWER LOGIC ---
  const checkAnswer = (userAns: any, correctAns: any, type: string) => {
    if (userAns === null || userAns === undefined) return false
    
    if (type === 'single_choice') {
      return Number(userAns) === Number(correctAns)
    }
    if (type === 'multi_choice') {
      const u = Array.isArray(userAns) ? userAns.sort().toString() : ''
      const c = Array.isArray(correctAns) ? correctAns.sort().toString() : ''
      return u === c
    }
    if (type === 'input') {
      // Clean Strings (handle 12,34 vs 12.34)
      const userStr = String(userAns).trim().replace(',', '.')
      const correctStr = String(correctAns).trim().replace(',', '.')

      // 1. Check Range (e.g. "11.7-12.1" from FS data)
      if (correctStr.includes('-') && !isNaN(parseFloat(correctStr.split('-')[0]))) {
         const parts = correctStr.split('-').map(p => parseFloat(p.trim()));
         if(parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
             const userNum = parseFloat(userStr);
             return !isNaN(userNum) && userNum >= parts[0] && userNum <= parts[1];
         }
      }

      // 2. Check Numeric Tolerance (1%)
      const uNum = parseFloat(userStr)
      const cNum = parseFloat(correctStr)
      if (!isNaN(uNum) && !isNaN(cNum)) {
          // Allow 1% error margin
          const tolerance = Math.abs(cNum) * 0.01; 
          return Math.abs(uNum - cNum) <= tolerance;
      }

      // 3. Fallback to exact string match
      return userStr.toLowerCase() === correctStr.toLowerCase()
    }
    return false
  }

  const handleNext = () => {
    if (selectedAnswer === null) return
    if (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) return
    if (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '') return

    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = selectedAnswer
    setAnswers(newAnswers)

    if (checkAnswer(selectedAnswer, currentQuestion.correct_answer, currentQuestion.type)) {
      setScore(prev => prev + 1)
    }

    if (isLastQuestion) {
      setQuizStarted(false)
      setShowResult(true)
      generateAIFeedback()
    } else {
      setCurrentQuestionIndex(prev => prev + 1)
      setSelectedAnswer(null)
    }
  }

  const generateAIFeedback = async () => {
    // Only generate AI feedback if in AI mode or if we want to add cost
    // For official questions, AI feedback is nice but optional. 
    // We will keep it for now.
    setLoadingFeedback(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-feedback', {
        body: {
          questions,
          answers,
          score,
          totalQuestions: questions.length,
          mode: 'individual'
        }
      })
      if (error) throw error
      setAiFeedback(data.feedback || data.detailed_analysis || "Quiz completed.")
    } catch (error) {
      console.error(error)
      setAiFeedback("Great job! (AI feedback unavailable)")
    } finally {
      setLoadingFeedback(false)
    }
  }

  // --- UI: Render Input Types ---
  const renderQuestionInput = () => {
    const { type, options } = currentQuestion

    if (type === 'single_choice') {
      return (
        <div className="space-y-3">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => setSelectedAnswer(index)}
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
      )
    }

    if (type === 'multi_choice') {
      return (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 font-medium mb-2 uppercase tracking-wide">Select all that apply:</p>
          {options.map((option, index) => {
            const isSelected = (selectedAnswer as number[])?.includes(index)
            return (
              <button
                key={index}
                onClick={() => handleMultiChoiceSelect(index)}
                className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 hover:shadow-md ${
                  isSelected
                    ? 'border-primary-600 bg-primary-50 shadow-sm'
                    : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center">
                  <div className={`mr-4 ${isSelected ? 'text-primary-600' : 'text-gray-300'}`}>
                    {isSelected ? <CheckSquare className="w-6 h-6" /> : <Square className="w-6 h-6" />}
                  </div>
                  <span className={`font-medium ${isSelected ? 'text-primary-900' : 'text-gray-700'}`}>
                    {option}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )
    }

    if (type === 'input') {
      return (
        <div className="mt-6">
          <label className="block text-sm font-bold text-gray-700 mb-2">
            Enter your calculated value:
          </label>
          <div className="relative rounded-md shadow-sm">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
              <Type className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full rounded-lg border-2 border-gray-300 pl-10 py-3 text-lg focus:border-primary-500 focus:ring-primary-500 transition-colors"
              placeholder="e.g., 12.34"
              value={selectedAnswer || ''}
              onChange={(e) => setSelectedAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNext()}
              autoFocus
            />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Type the exact number or string required by the question. Use a dot or comma.
          </p>
        </div>
      )
    }
  }

  // ==================== RENDER ====================

  // 1. SETTINGS (LOBBY)
  if (showSettings) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">New Quiz Session</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Configure your training parameters</p>
        </div>

        <div className="card p-4 sm:p-6 space-y-6">

          {/* --- MODE SELECTOR --- */}
          <div className="flex justify-center mb-4">
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
          
          {/* --- OFFICIAL MODE FILTERS --- */}
          {quizMode === 'official' && (
             <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100">
                <div>
                   <label className="block text-xs font-bold text-blue-800 uppercase tracking-wide mb-2 flex items-center">
                      <Filter className="w-3 h-3 mr-1" /> Competition
                   </label>
                   <select 
                      value={quizSettings.sourceFilter}
                      onChange={(e) => setQuizSettings(prev => ({...prev, sourceFilter: e.target.value}))}
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
                      value={quizSettings.yearFilter}
                      onChange={(e) => setQuizSettings(prev => ({...prev, yearFilter: e.target.value}))}
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

          {/* --- AI MODE DOCUMENT SELECTOR --- */}
          {quizMode === 'ai' && (
            <div>
                <div className="flex items-center space-x-2 mb-3">
                <BookOpen className="w-5 h-5 text-primary-600" />
                <h3 className="text-sm sm:text-base font-medium text-gray-900">Select Knowledge Base</h3>
                </div>
                <div className="border-2 border-gray-200 rounded-lg overflow-hidden">
                {availableDocuments.length === 0 ? (
                    <div className="p-3 sm:p-4 text-center text-gray-500 bg-gray-50 text-sm sm:text-base">
                    No documents found. Go to "Documents" to upload content.
                    </div>
                ) : (
                    <div className="max-h-40 sm:max-h-48 overflow-y-auto divide-y divide-gray-100 bg-gray-50">
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

          {/* COMMON INPUTS: Question Count & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Question Count
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Hash className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={quizSettings.questionCount}
                  onChange={(e) => setQuizSettings(prev => ({ ...prev, questionCount: Math.max(1, parseInt(e.target.value) || 0) }))}
                  className="input-field pl-10 w-full"
                  placeholder="e.g. 5"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
                Time Limit (Mins)
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={quizSettings.timeLimit}
                  onChange={(e) => setQuizSettings(prev => ({ ...prev, timeLimit: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="input-field pl-10 w-full"
                  placeholder="e.g. 10"
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generateQuiz}
            disabled={generating || (quizMode === 'ai' && selectedDocuments.size === 0)}
            className="btn-primary w-full py-3 text-base sm:text-lg shadow-sm flex justify-center items-center"
          >
            {generating ? (
              <>
                <Loader className="w-5 h-5 animate-spin mr-2" />
                Preparing Quiz...
              </>
            ) : (
              <>
                {quizMode === 'ai' ? <Brain className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
                Start {quizMode === 'official' ? 'Official' : 'AI'} Session
              </>
            )}
          </button>
        </div>
      </div>
    )
  }

  // 2. LOADING
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Loader className="w-12 h-12 animate-spin text-primary-600 mb-4" />
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Constructing Quiz...</h2>
        <p className="text-sm sm:text-base text-gray-500 mt-2 max-w-md px-4">
          Retrieving data and preparing your session...
        </p>
      </div>
    )
  }

  // 3. START SCREEN
  if (!quizStarted && !showResult) {
    // This state is technically skipped by the auto-start in generateQuiz, 
    // but kept as a fallback state if needed.
    return (
      <div className="max-w-2xl mx-auto text-center pt-4 sm:pt-8">
         <Loader className="w-10 h-10 mx-auto animate-spin text-primary-500"/>
      </div>
    )
  }

  // 4. RESULTS
  if (showResult) {
    return (
      <div className="max-w-4xl mx-auto pb-8 sm:pb-12">
        <div className="text-center mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Quiz Results</h1>
        </div>

        <div className="card text-center mb-6 p-4 sm:p-6">
          <div className="mb-6">
            <Trophy className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 ${getScoreColor()}`} />
            <h2 className={`text-2xl sm:text-4xl font-bold mb-2 ${getScoreColor()}`}>
              {score} / {questions.length}
            </h2>
            <p className="text-sm sm:text-base text-gray-600">
              {Math.round((score / questions.length) * 100)}% Correct
            </p>
          </div>

          <div className="bg-blue-50 p-4 sm:p-5 rounded-lg text-left border border-blue-100">
            <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide mb-2 flex items-center">
              <Brain className="w-4 h-4 mr-2" />
              AI Coach Feedback
            </h3>
            {loadingFeedback ? (
              <div className="flex items-center py-2 text-blue-700">
                <Loader className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm sm:text-base">Analyzing performance...</span>
              </div>
            ) : (
              <div className="prose prose-sm text-blue-800 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                {aiFeedback}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 sm:space-y-4">
          <h3 className="font-semibold text-gray-900 px-1 text-base sm:text-lg">Detailed Review</h3>
          {questions.map((q, i) => {
            const userAns = answers[i]
            const isCorrect = checkAnswer(userAns, q.correct_answer, q.type)
            
            return (
              <div key={q.id} className={`p-4 sm:p-5 border-2 rounded-xl ${isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-1 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isCorrect ? 'bg-green-200 text-green-700' : 'bg-red-200 text-red-700'}`}>
                    {isCorrect ? <Check className="w-4 h-4" /> : <span className="text-xs font-bold">✕</span>}
                  </div>
                  <div className="flex-1 w-full">
                    <div className="mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider opacity-70 mb-1 block">
                            {q.type.replace('_', ' ')}
                        </span>
                        <p className="font-bold text-gray-900 text-base sm:text-lg">
                        {i + 1}. {q.question}
                        </p>
                    </div>

                    {/* --- IMAGE IN RESULTS --- */}
                    {q.image_path && (
                         <div className="my-4 bg-white/60 p-2 rounded border border-gray-300/50 flex justify-center">
                            <img 
                                src={`https://img.fs-quiz.eu/${q.image_path}`} 
                                className="max-h-48 object-contain"
                                alt="Question Diagram"
                            />
                         </div>
                    )}
                    
                    {q.type === 'input' ? (
                        <div className="bg-white/50 p-2 sm:p-3 rounded-lg mb-3 border border-gray-200">
                            <p className="text-sm"><span className="font-bold text-gray-600">Your Answer:</span> <span className="font-mono">{userAns || "—"}</span></p>
                            <p className="text-sm"><span className="font-bold text-gray-600">Correct Answer:</span> <span className="font-mono text-green-700">{q.correct_answer}</span></p>
                        </div>
                    ) : (
                        <div className="space-y-1 sm:space-y-2 mb-4">
                        {q.options?.map((opt, idx) => {
                            let style = "bg-white text-gray-600 border-gray-200"
                            const isUserSelected = Array.isArray(userAns) ? userAns.includes(idx) : userAns === idx
                            const isActuallyCorrect = Array.isArray(q.correct_answer) 
                                ? (q.correct_answer as number[]).includes(idx)
                                : q.correct_answer === idx

                            if (isActuallyCorrect) style = "bg-green-100 text-green-900 border-green-300 font-bold"
                            else if (isUserSelected && !isActuallyCorrect) style = "bg-red-100 text-red-900 border-red-300 line-through"

                            return (
                                <div key={idx} className={`p-2 sm:p-3 rounded-lg border text-sm flex justify-between items-center ${style}`}>
                                    <span>{String.fromCharCode(65 + idx)}. {opt}</span>
                                    {isActuallyCorrect && <Check className="w-4 h-4" />}
                                </div>
                            )
                        })}
                        </div>
                    )}
                    
                    <div className="text-sm text-gray-700 bg-white/60 p-2 sm:p-3 rounded border border-gray-200/50">
                      <span className="font-bold text-gray-900 block mb-1">Explanation:</span>
                      {q.explanation}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <button onClick={handleRestart} className="btn-primary shadow-lg px-8 sm:px-10 py-3 text-base sm:text-lg rounded-full">
            Start New Session
          </button>
        </div>
      </div>
    )
  }

  // 5. ACTIVE QUIZ
  return (
    <div className="max-w-4xl mx-auto pt-4 sm:pt-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 space-y-2 sm:space-y-0">
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
          Question {currentQuestionIndex + 1} of {questions.length}
        </span>
        {quizSettings.timeLimit > 0 && (
          <div className={`flex items-center space-x-2 px-4 py-2 rounded-lg border ${
             timeRemaining < 60 ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' : 'bg-white border-gray-200 text-gray-700'
          }`}>
            <Clock className="w-4 h-4" />
            <span className="font-mono font-bold text-base sm:text-lg">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2 mb-8">
        <div 
          className="bg-primary-600 h-2 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      <div className="card p-4 sm:p-6 lg:p-8 shadow-lg">
        <div className="mb-4">
           <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600 uppercase tracking-wider">
             {currentQuestion.type.replace('_', ' ')}
           </span>
        </div>
        
        <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 mb-6 sm:mb-8 leading-snug">
          {currentQuestion.question}
        </h2>

        {/* --- IMAGE RENDERING (ACTIVE) --- */}
        {currentQuestion.image_path && (
            <div className="mb-8 flex justify-center bg-gray-50 p-4 rounded-xl border border-gray-100">
                <img 
                    src={`https://img.fs-quiz.eu/${currentQuestion.image_path}`} 
                    alt="Question Diagram"
                    className="max-h-80 object-contain rounded"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                />
            </div>
        )}

        {renderQuestionInput()}

        <div className="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-gray-100 flex justify-end">
          <button
            onClick={handleNext}
            disabled={
                selectedAnswer === null || 
                (Array.isArray(selectedAnswer) && selectedAnswer.length === 0) || 
                (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '')
            }
            className="btn-primary px-6 sm:px-8 py-3 text-base sm:text-lg disabled:opacity-50 disabled:cursor-not-allowed transition-transform active:scale-95"
          >
            {isLastQuestion ? 'Submit Quiz' : 'Next Question'}
          </button>
        </div>
      </div>
    </div>
  )
}