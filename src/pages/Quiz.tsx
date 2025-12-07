import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Brain, Trophy, Loader, Clock, BookOpen, Check, Hash, Image as ImageIcon, Filter, RefreshCw } from 'lucide-react'

// --- Types ---
interface QuizQuestion {
  id: string
  type: 'single_choice' | 'multi_choice' | 'input'
  question: string
  options: string[] 
  // For logic, we store what the 'correct' value is (index or string value)
  correct_answer: string | number | number[] 
  explanation: string
  image_path?: string | null 
}

export default function Quiz() {
  const { user } = useAuth()
  
  // --- State ---
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState<any>(null)
  const [showResult, setShowResult] = useState(false)
  const [score, setScore] = useState(0)
  const [answers, setAnswers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  
  // Quiz Configuration
  const [quizMode, setQuizMode] = useState<'official' | 'ai'>('official') 
  const [quizSettings, setQuizSettings] = useState({
    questionCount: 10,
    timeLimit: 15,
    yearFilter: 'all', // 'all' or specific year
    sourceFilter: 'all' // 'all' or specific event (FSG, FSN, etc)
  })
  
  // Timer State
  const [timeRemaining, setTimeRemaining] = useState(0)
  const [quizStarted, setQuizStarted] = useState(false)
  
  // AI Context State
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [availableDocuments, setAvailableDocuments] = useState<any[]>([])

  // Computed Properties
  const currentQuestion = questions[currentQuestionIndex]
  const isLastQuestion = currentQuestionIndex === questions.length - 1

  // --- Effects ---

  // Timer
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (quizStarted && timeRemaining > 0 && !showResult) {
      interval = setInterval(() => {
        setTimeRemaining(prev => {
           if (prev <= 1) {
               handleFinishQuiz()
               return 0
           }
           return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [quizStarted, timeRemaining, showResult])

  // Load Documents for AI mode
  useEffect(() => {
    if (quizMode === 'ai') {
        fetchDocuments()
    }
  }, [quizMode])

  // --- Helpers ---

  const fetchDocuments = async () => {
    const { data } = await supabase.from('documents').select('id, name')
    setAvailableDocuments(data || [])
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // --- MAIN LOGIC: GENERATE QUIZ ---

  const generateQuiz = async () => {
    setGenerating(true)
    setQuestions([]) // Clear previous
    try {
      let newQuestions: QuizQuestion[] = []

      if (quizMode === 'ai') {
        // --- AI MODE (Your existing logic) ---
         if (selectedDocuments.size === 0) { 
             alert("Please select at least one document for AI context."); 
             setGenerating(false); 
             return; 
         }
         
         const { data, error } = await supabase.functions.invoke('generate-quiz', {
            body: { 
              count: quizSettings.questionCount,
              selectedDocuments: Array.from(selectedDocuments)
            }
         })
         if (error) throw error
         newQuestions = data.questions || []
      } 
      else {
        // --- OFFICIAL BANK MODE ---
        let query = supabase.from('question_bank').select('*')
        
        // Apply Filters
        if (quizSettings.yearFilter !== 'all') {
            query = query.eq('year', parseInt(quizSettings.yearFilter))
        }
        if (quizSettings.sourceFilter !== 'all') {
            query = query.eq('source_event', quizSettings.sourceFilter)
        }

        // Random Limit (Note: 'random' sort in Postgres can be slow on huge tables, but fine for <10k rows)
        // Using a simple random sort strategy here
        const { data, error } = await query.limit(quizSettings.questionCount)

        if (error) throw error
        if (!data || data.length === 0) {
            alert("No questions found with these filters. Try adjusting them.")
            setGenerating(false)
            return
        }

        // Shuffle the results locally to ensure randomness if the DB query wasn't perfectly random
        const shuffledData = data.sort(() => 0.5 - Math.random())

        // Transform DB data to UI format
        newQuestions = shuffledData.map((q: any) => {
          // The 'options' column is JSONB. Structure: [{ "text": "...", "is_correct": boolean }]
          // IMPORTANT: Check if options is a string (double-encoded) or object
          let rawOptions = q.options
          if (typeof rawOptions === 'string') {
             try { rawOptions = JSON.parse(rawOptions) } catch(e) {}
          }
          
          const opts = Array.isArray(rawOptions) ? rawOptions.map((o: any) => o.text) : []
          
          let correctVal: any = null

          // Determine Correct Answer based on Type
          if (q.type === 'single-choice') {
             // Find index of is_correct: true
             correctVal = Array.isArray(rawOptions) ? rawOptions.findIndex((o: any) => o.is_correct === true) : -1
          } 
          else if (q.type === 'multi_choice') {
             // Find array of indices
             correctVal = Array.isArray(rawOptions) 
               ? rawOptions.map((o: any, idx: number) => o.is_correct ? idx : -1).filter((idx: number) => idx !== -1)
               : []
          } 
          else {
             // INPUT Types
             // The correct answer is inside the options array as 'text'
             const correctObj = Array.isArray(rawOptions) ? rawOptions.find((o: any) => o.is_correct === true) : null
             correctVal = correctObj ? correctObj.text : ""
          }

          // Handle Image Path
          // Data format: images: [{"img_id": 1, "path": "question/12_1.jpg"}]
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
            // Map DB types to Frontend Types
            type: (q.type === 'input-range' ? 'input' : q.type) as any, 
            question: q.question_text,
            options: opts,
            correct_answer: correctVal,
            explanation: q.explanation || "No explanation provided.",
            difficulty: 'Hard',
            image_path: imgPath
          }
        })
      }
      
      setQuestions(newQuestions)
      resetQuiz(newQuestions.length)
      setShowSettings(false)
      startQuiz(newQuestions.length) // Auto-start

    } catch (error) {
      console.error(error)
      alert("Failed to load quiz")
    } finally {
      setGenerating(false)
    }
  }

  // --- GAMEPLAY LOGIC ---

  const resetQuiz = (count: number) => {
    setCurrentQuestionIndex(0)
    setSelectedAnswer(null)
    setShowResult(false)
    setScore(0)
    setAnswers(new Array(count).fill(null))
    setQuizStarted(false)
  }

  const startQuiz = (qCount: number) => {
    setQuizStarted(true)
    if(quizSettings.timeLimit > 0) {
        setTimeRemaining(quizSettings.timeLimit * 60)
    } else {
        setTimeRemaining(9999) // Infinite
    }
  }

  const handleFinishQuiz = () => {
      setQuizStarted(false)
      setShowResult(true)
  }

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
      // Smart String/Number Comparison
      const userStr = String(userAns).trim().replace(',', '.')
      const correctStr = String(correctAns).trim().replace(',', '.')

      // 1. Check Range (e.g. "11.7-12.1") from your data
      if (correctStr.includes('-') && !isNaN(parseFloat(correctStr.split('-')[0]))) {
         // This assumes the format "min-max"
         const parts = correctStr.split('-').map(p => parseFloat(p.trim()))
         if(parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
             const userNum = parseFloat(userStr)
             return !isNaN(userNum) && userNum >= parts[0] && userNum <= parts[1]
         }
      }

      // 2. Check Numeric Tolerance (1%)
      const uNum = parseFloat(userStr)
      const cNum = parseFloat(correctStr)
      if (!isNaN(uNum) && !isNaN(cNum)) {
        // If it's a number, allow small floating point differences
        // or a 1% margin of error for engineering calc
        return Math.abs(uNum - cNum) <= (Math.abs(cNum) * 0.02) // 2% tolerance
      }

      // 3. Fallback String Match
      return userStr.toLowerCase() === correctStr.toLowerCase()
    }
    return false
  }

  const handleNext = () => {
    // Save Answer
    const newAnswers = [...answers]
    newAnswers[currentQuestionIndex] = selectedAnswer
    setAnswers(newAnswers)

    // Check Score
    if (checkAnswer(selectedAnswer, currentQuestion.correct_answer, currentQuestion.type)) {
      setScore(prev => prev + 1)
    }

    if (isLastQuestion) {
      handleFinishQuiz()
    } else {
      setCurrentQuestionIndex(prev => prev + 1)
      setSelectedAnswer(null)
    }
  }
  
  const handleMultiChoiceSelect = (index: number) => {
    const current = (selectedAnswer as number[]) || []
    if (current.includes(index)) {
      setSelectedAnswer(current.filter(i => i !== index))
    } else {
      setSelectedAnswer([...current, index].sort())
    }
  }

  // --- RENDER HELPERS ---

  const renderQuestionInput = () => {
    if (!currentQuestion) return null

    if (currentQuestion.type === 'input') {
        return (
          <div className="mt-6">
            <label className="text-sm font-semibold text-gray-700">Your Calculation</label>
            <input
              type="text"
              className="mt-2 block w-full p-4 text-lg border-2 border-gray-300 rounded-xl focus:border-primary-500 focus:ring-0 outline-none transition-colors"
              placeholder="Enter value (e.g. 42.5)"
              value={selectedAnswer || ''}
              onChange={(e) => setSelectedAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNext()}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-2">
                Use a dot (.) or comma (,) for decimals.
            </p>
          </div>
        )
    }

    if (currentQuestion.type === 'single_choice') {
      return (
        <div className="space-y-3">
          {currentQuestion.options.map((option, index) => (
            <button
              key={index}
              onClick={() => setSelectedAnswer(index)}
              className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 ${
                selectedAnswer === index 
                    ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-600' 
                    : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start">
                  <span className={`inline-flex items-center justify-center w-6 h-6 mr-3 text-sm font-bold rounded-full border ${
                      selectedAnswer === index ? 'bg-primary-600 text-white border-primary-600' : 'text-gray-500 border-gray-300'
                  }`}>
                      {String.fromCharCode(65 + index)}
                  </span>
                  <span className={selectedAnswer === index ? 'font-medium text-gray-900' : 'text-gray-700'}>
                      {option}
                  </span>
              </div>
            </button>
          ))}
        </div>
      )
    }
    
    if (currentQuestion.type === 'multi_choice') {
        return (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 font-medium uppercase tracking-wide mb-2">Select all that apply</p>
            {currentQuestion.options.map((option, index) => {
              const isSelected = (selectedAnswer as number[])?.includes(index)
              return (
                <button
                  key={index}
                  onClick={() => handleMultiChoiceSelect(index)}
                  className={`w-full text-left p-4 border-2 rounded-xl transition-all duration-200 ${
                    isSelected 
                        ? 'border-primary-600 bg-primary-50' 
                        : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center">
                    <div className={`mr-3 ${isSelected ? 'text-primary-600' : 'text-gray-300'}`}>
                       <div className={`w-6 h-6 border-2 rounded-md flex items-center justify-center ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                           {isSelected && <Check className="w-4 h-4 text-white" />}
                       </div>
                    </div>
                    <span className={isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}>
                      {option}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )
      }
    
    return null
  }

  // ==================== VIEWS ====================

  // 1. SETTINGS VIEW
  if (showSettings) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Start Quiz Session</h1>
            <p className="text-gray-600 mt-1">Configure your training parameters</p>
        </div>
        
        <div className="card p-6 md:p-8 space-y-8">
            {/* Mode Selector */}
            <div className="flex justify-center">
                <div className="bg-gray-100 p-1 rounded-xl inline-flex relative">
                    <div 
                        className={`absolute top-1 bottom-1 w-1/2 bg-white rounded-lg shadow-sm transition-all duration-300 ease-in-out ${quizMode === 'ai' ? 'left-[4px] translate-x-full' : 'left-[4px]'}`}
                        style={{ width: 'calc(50% - 4px)' }}
                    />
                    <button 
                        onClick={() => setQuizMode('official')}
                        className={`relative z-10 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-300 ${quizMode === 'official' ? 'text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Official Questions
                    </button>
                    <button 
                        onClick={() => setQuizMode('ai')}
                        className={`relative z-10 px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors duration-300 ${quizMode === 'ai' ? 'text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        AI Generator
                    </button>
                </div>
            </div>

            {/* Official Mode Filters */}
            {quizMode === 'official' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div>
                        <label className="block text-xs font-bold text-blue-800 uppercase mb-2">Source Event</label>
                        <select 
                            value={quizSettings.sourceFilter}
                            onChange={(e) => setQuizSettings({...quizSettings, sourceFilter: e.target.value})}
                            className="input-field w-full bg-white"
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
                        <label className="block text-xs font-bold text-blue-800 uppercase mb-2">Year</label>
                        <select 
                            value={quizSettings.yearFilter}
                            onChange={(e) => setQuizSettings({...quizSettings, yearFilter: e.target.value})}
                            className="input-field w-full bg-white"
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
                <div className="space-y-3">
                   <div className="flex items-center space-x-2">
                      <BookOpen className="w-5 h-5 text-primary-600" />
                      <h3 className="font-semibold text-gray-900">Select Knowledge Base</h3>
                   </div>
                   <div className="max-h-48 overflow-y-auto border-2 border-gray-200 rounded-xl divide-y divide-gray-100">
                      {availableDocuments.length === 0 ? (
                          <div className="p-4 text-center text-gray-500 text-sm">No documents found.</div>
                      ) : (
                          availableDocuments.map(doc => (
                              <div key={doc.id} onClick={() => {
                                  const next = new Set(selectedDocuments);
                                  next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id);
                                  setSelectedDocuments(next);
                              }} className={`p-3 flex items-center cursor-pointer hover:bg-gray-50 ${selectedDocuments.has(doc.id) ? 'bg-primary-50' : ''}`}>
                                  <div className={`w-5 h-5 border rounded mr-3 flex items-center justify-center ${selectedDocuments.has(doc.id) ? 'bg-primary-600 border-primary-600' : 'border-gray-300'}`}>
                                     {selectedDocuments.has(doc.id) && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-sm text-gray-700">{doc.name}</span>
                              </div>
                          ))
                      )}
                   </div>
                </div>
            )}

            {/* Common Settings */}
            <div className="grid grid-cols-2 gap-6">
                <div>
                    <label className="label">Question Count</label>
                    <div className="relative">
                        <Hash className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <input 
                            type="number" min="1" max="50"
                            value={quizSettings.questionCount}
                            onChange={(e) => setQuizSettings({...quizSettings, questionCount: Number(e.target.value)})}
                            className="input-field pl-10 w-full"
                        />
                    </div>
                </div>
                <div>
                    <label className="label">Time Limit (Min)</label>
                    <div className="relative">
                        <Clock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <input 
                            type="number" min="0" max="180"
                            value={quizSettings.timeLimit}
                            onChange={(e) => setQuizSettings({...quizSettings, timeLimit: Number(e.target.value)})}
                            className="input-field pl-10 w-full"
                        />
                    </div>
                </div>
            </div>

            <button onClick={generateQuiz} disabled={generating} className="btn-primary w-full py-4 text-lg shadow-lg flex items-center justify-center space-x-2">
                {generating ? <Loader className="w-6 h-6 animate-spin" /> : <Brain className="w-6 h-6" />}
                <span>{generating ? 'Preparing Quiz...' : 'Start Quiz'}</span>
            </button>
        </div>
      </div>
    )
  }

  // 2. RESULTS VIEW
  if (showResult) {
      return (
          <div className="max-w-3xl mx-auto text-center py-8">
              <div className="card p-8 mb-8">
                  <div className="inline-flex p-4 bg-yellow-50 rounded-full mb-6">
                      <Trophy className="w-12 h-12 text-yellow-600" />
                  </div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Quiz Completed!</h1>
                  <div className="text-5xl font-bold text-primary-600 mb-4">{Math.round((score / questions.length) * 100)}%</div>
                  <p className="text-gray-600 mb-8">You answered {score} out of {questions.length} correctly.</p>
                  
                  <div className="flex justify-center space-x-4">
                      <button onClick={() => setShowSettings(true)} className="btn-primary px-8">New Session</button>
                  </div>
              </div>
              
              <div className="space-y-4 text-left">
                  <h3 className="font-bold text-xl text-gray-800 ml-2">Review</h3>
                  {questions.map((q, i) => {
                      const correct = checkAnswer(answers[i], q.correct_answer, q.type);
                      return (
                          <div key={q.id} className={`card p-6 border-l-4 ${correct ? 'border-l-green-500' : 'border-l-red-500'}`}>
                             <div className="flex justify-between items-start mb-2">
                                <span className="text-xs font-bold text-gray-500 uppercase">Question {i+1}</span>
                                {correct 
                                    ? <span className="text-green-600 font-bold text-sm flex items-center"><Check className="w-4 h-4 mr-1"/> Correct</span> 
                                    : <span className="text-red-600 font-bold text-sm">Incorrect</span>
                                }
                             </div>
                             <p className="font-semibold text-gray-900 mb-4">{q.question}</p>
                             
                             {q.image_path && (
                                <img src={`https://img.fs-quiz.eu/${q.image_path}`} className="h-32 object-contain mb-4 border rounded" />
                             )}
                             
                             <div className="bg-gray-50 p-4 rounded-lg text-sm text-gray-700">
                                <p><span className="font-bold">Correct Answer:</span> {
                                    q.type === 'input' 
                                        ? q.correct_answer 
                                        : (Array.isArray(q.correct_answer) 
                                            ? (q.correct_answer as number[]).map(idx => String.fromCharCode(65+idx)).join(', ') 
                                            : String.fromCharCode(65 + (q.correct_answer as number)))
                                }</p>
                                {q.explanation && (
                                    <p className="mt-2 pt-2 border-t border-gray-200"><span className="font-bold">Explanation:</span> {q.explanation}</p>
                                )}
                             </div>
                          </div>
                      )
                  })}
              </div>
          </div>
      )
  }

  // 3. ACTIVE GAMEPLAY VIEW
  return (
    <div className="max-w-4xl mx-auto pt-6">
        <div className="flex justify-between items-center mb-6">
            <span className="text-sm font-bold text-gray-500 uppercase">Question {currentQuestionIndex + 1} of {questions.length}</span>
            <div className={`flex items-center space-x-2 px-4 py-2 rounded-lg border ${timeRemaining < 60 ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-white border-gray-200'}`}>
                <Clock className="w-4 h-4" />
                <span className="font-mono font-bold text-lg">{formatTime(timeRemaining)}</span>
            </div>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-1.5 mb-8">
            <div className="bg-primary-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}></div>
        </div>

        <div className="card p-6 md:p-10 shadow-xl">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-6 leading-snug">
                {currentQuestion.question}
            </h2>

            {/* --- IMAGE RENDERING --- */}
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

            <div className="mt-10 pt-6 border-t border-gray-100 flex justify-end">
                <button 
                    onClick={handleNext} 
                    className="btn-primary px-8 py-3 text-lg"
                    disabled={selectedAnswer === null || (typeof selectedAnswer === 'string' && selectedAnswer.trim() === '')}
                >
                    {isLastQuestion ? 'Finish Quiz' : 'Next Question'}
                </button>
            </div>
        </div>
    </div>
  )
}