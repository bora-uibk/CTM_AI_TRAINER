import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Upload, FileText, Download, Trash2, Loader, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Check, Settings, Database, FileJson, List } from 'lucide-react'

// --- Existing Interface ---
interface Document {
  id: string
  name: string
  content: string
  file_path: string
  file_size: number
  mime_type: string
  uploaded_by: string
  created_at: string
  updated_at: string
}

interface Message {
  type: 'success' | 'error'
  text: string
}

export default function Documents() {
  const { user } = useAuth()
  
  // --- Existing State ---
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [pdfLibReady, setPdfLibReady] = useState(false)

  // --- New State for Question Bank ---
  const [importingBank, setImportingBank] = useState(false)
  const [bankLog, setBankLog] = useState<string[]>([])
  const [showBankLogs, setShowBankLogs] = useState(false)

  // --- Effects ---
  useEffect(() => {
    fetchDocuments()
    loadSelectedDocuments()
    
    // --- FIX: Load Stable PDF.js from CDN ---
    const script = window.document.createElement('script')
    script.src = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.async = true
    script.onload = () => {
      // Set the worker source to match the library version exactly
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      setPdfLibReady(true)
    }
    window.document.body.appendChild(script)

    return () => {
      if (window.document.body.contains(script)) {
        window.document.body.removeChild(script)
      }
    }
  }, [])

  // --- Existing Helpers ---
  const loadSelectedDocuments = () => {
    try {
      const saved = localStorage.getItem('selectedDocuments')
      if (saved) {
        const parsed = JSON.parse(saved)
        setSelectedDocuments(new Set(parsed))
      }
    } catch (error) {
      console.error('Error loading selected documents:', error)
    }
  }

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      setDocuments(data || [])
    } catch (error) {
      console.error('Error fetching documents:', error)
      showMessage('error', 'Failed to fetch documents')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const extractTextFromPDF = async (file: File): Promise<string> => {
    if (!pdfLibReady || !(window as any).pdfjsLib) {
      throw new Error('PDF Library not loaded yet. Please try again in a few seconds.')
    }

    return new Promise(async (resolve, reject) => {
      try {
        const arrayBuffer = await file.arrayBuffer()
        
        // Use the window-scoped library
        const loadingTask = (window as any).pdfjsLib.getDocument({ data: arrayBuffer })
        const pdf = await loadingTask.promise
        
        let fullText = ''
        const totalPages = pdf.numPages

        // Iterate through every page
        for (let i = 1; i <= totalPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ')
          
          // Add explicit page markers
          fullText += `\n--- Page ${i} ---\n${pageText}\n`
        }

        if (fullText.trim().length > 0) {
          resolve(fullText)
        } else {
          resolve(`[PDF Document: ${file.name}] - No selectable text found. This might be a scanned image.`)
        }
      } catch (error) {
        console.error('PDF parsing error:', error)
        resolve(`[PDF Document: ${file.name}] - Failed to parse PDF. Error: ${(error as any).message}`)
      }
    })
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !user) return

    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      showMessage('error', 'File size must be less than 10MB')
      event.target.value = ''
      return
    }

    const allowedTypes = ['application/pdf', 'text/plain']
    if (!allowedTypes.includes(file.type)) {
      showMessage('error', 'Only PDF and TXT files are supported')
      event.target.value = ''
      return
    }

    setUploading(true)
    setUploadProgress('Preparing file...')

    try {
      // Extract text content
      let textContent = ''
      if (file.type === 'application/pdf') {
        setUploadProgress('Extracting text layers from PDF...')
        textContent = await extractTextFromPDF(file)
      } else {
        setUploadProgress('Reading text file...')
        textContent = await file.text()
      }

      // Upload file to storage
      setUploadProgress('Uploading file...')
      const fileName = `${Date.now()}-${file.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file)

      if (uploadError) throw uploadError

      // Process document with edge function
      setUploadProgress('Processing embeddings (this may take a moment)...')
      const { data: processData, error: processError } = await supabase.functions
        .invoke('process-document', {
          body: {
            name: file.name,
            content: textContent,
            file_path: uploadData.path,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: user.id
          }
        })

      if (processError) throw processError

      showMessage('success', 'Document uploaded and processed successfully!')
      fetchDocuments()
    } catch (error) {
      console.error('Error uploading document:', error)
      showMessage('error', 'Failed to upload document')
    } finally {
      setUploading(false)
      setUploadProgress('')
      event.target.value = ''
    }
  }

  const handleDownload = async (document: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(document.file_path)

      if (error) throw error

      const url = URL.createObjectURL(data)
      const a = window.document.createElement('a')
      a.href = url
      a.download = document.name
      window.document.body.appendChild(a)
      a.click()
      window.document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error downloading document:', error)
      showMessage('error', 'Failed to download document')
    }
  }

  const handleDelete = async (document: Document) => {
    if (!confirm(`Are you sure you want to delete "${document.name}"?`)) return

    try {
      const { error: storageError } = await supabase.storage
        .from('documents')
        .remove([document.file_path])

      if (storageError) throw storageError

      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', document.id)

      if (dbError) throw dbError

      showMessage('success', 'Document deleted successfully!')
      fetchDocuments()
    } catch (error) {
      console.error('Error deleting document:', error)
      showMessage('error', 'Failed to delete document')
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

  const selectAllDocuments = () => {
    const validDocs = documents.filter(doc => 
      doc.content && 
      !doc.content.startsWith('[PDF Document:') && 
      doc.content.length > 100
    )
    const allIds = new Set(validDocs.map(doc => doc.id))
    setSelectedDocuments(allIds)
    localStorage.setItem('selectedDocuments', JSON.stringify(Array.from(allIds)))
  }

  const clearSelection = () => {
    setSelectedDocuments(new Set())
    localStorage.setItem('selectedDocuments', JSON.stringify([]))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // --- NEW: Handle Question Bank Import ---
  const handleQuestionBankUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportingBank(true);
    setBankLog([]);
    setShowBankLogs(true);
    
    // Helper logger
    const log = (msg: string) => setBankLog(prev => [...prev, msg]);

    try {
        log("Reading file...");
        const text = await file.text();
        
        // 1. Split logic
        log("Parsing content...");
        // Split by the word "QUIZ" followed by a space and a number
        const parts = text.split(/QUIZ \d+/).filter(part => part.trim().length > 0);
        
        log(`Found ${parts.length} quiz blocks.`);
        
        let allQuestionsToInsert: any[] = [];
  
        for (let i = 0; i < parts.length; i++) {
          let jsonStr = parts[i].trim();
          try {
            // Fix newlines that break JSON
            jsonStr = jsonStr.replace(/(?:\r\n|\r|\n)/g, ' '); 
            
            const quiz = JSON.parse(jsonStr);
            const eventName = quiz.event && quiz.event[0] ? quiz.event[0].short_name : 'Unknown';
            
            // Map to our DB schema
            const quizQuestions = quiz.questions.map((q: any) => {
               // Extract solution text safely
               const solText = q.solution && q.solution[0] ? q.solution[0].text : null;
               
               return {
                  external_id: q.question_id,
                  quiz_id: quiz.quiz_id,
                  year: parseInt(quiz.year) || 0,
                  class: quiz.class,
                  source_event: eventName,
                  type: q.type, // 'single-choice', 'input', etc.
                  question_text: q.text,
                  options: q.answers, // JSONB array of options
                  images: q.images,   // JSONB array of image paths
                  explanation: solText
               };
            });
            
            allQuestionsToInsert.push(...quizQuestions);
            
          } catch (e: any) {
             console.error("Parse error block " + i, e);
             log(`Warning: Failed to parse block ${i}: ${e.message.substring(0,50)}...`);
          }
        }

        log(`Prepared ${allQuestionsToInsert.length} questions for upload.`);
        
        // 2. Batch Upload
        const BATCH_SIZE = 50;
        for (let i = 0; i < allQuestionsToInsert.length; i += BATCH_SIZE) {
            const batch = allQuestionsToInsert.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('question_bank').insert(batch);
            if(error) throw error;
            log(`Uploaded ${Math.min(i + BATCH_SIZE, allQuestionsToInsert.length)} / ${allQuestionsToInsert.length}`);
        }

        log("Import Complete Successfully!");
        showMessage('success', `Imported ${allQuestionsToInsert.length} questions to the Bank.`);

    } catch (error: any) {
        console.error(error);
        log(`CRITICAL ERROR: ${error.message}`);
        showMessage('error', "Import failed. Check logs.");
    } finally {
        setImportingBank(false);
        event.target.value = ''; // Reset input
    }
  }

  // --- Render ---
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Training Documents</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">
            Upload Formula Student rulebooks, guides, and reference materials
          </p>
          {selectedDocuments.size > 0 && (
            <p className="text-primary-600 text-sm mt-1">
              {selectedDocuments.size} document{selectedDocuments.size !== 1 ? 's' : ''} selected for processing
            </p>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-3 sm:p-4 rounded-lg flex items-start space-x-2 ${
          message.type === 'success' 
            ? 'bg-success-50 border border-success-200' 
            : 'bg-danger-50 border border-danger-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-danger-600 flex-shrink-0 mt-0.5" />
          )}
          <span className={`text-sm sm:text-base ${message.type === 'success' ? 'text-success-700' : 'text-danger-700'}`}>
            {message.text}
          </span>
        </div>
      )}

      {/* 1. Main Document Upload Section (RAG) */}
      <div className="card">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 sm:p-8 text-center hover:border-primary-400 transition-colors">
          <Upload className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">
            Upload Training Documents
          </h3>
          <p className="text-sm sm:text-base text-gray-600 mb-4">
            Supported formats: PDF, TXT (Max 10MB)
          </p>
          {uploading && uploadProgress && (
            <p className="text-xs sm:text-sm text-primary-600 mb-3 font-medium">
              {uploadProgress}
            </p>
          )}
          <label className={`btn-primary cursor-pointer inline-block px-6 py-3 ${!pdfLibReady ? 'opacity-50' : ''}`}>
            {uploading ? (
              <span className="flex items-center space-x-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span className="text-sm sm:text-base">Processing...</span>
              </span>
            ) : (
              <span className="text-sm sm:text-base">Choose File</span>
            )}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.txt"
              onChange={handleFileUpload}
              disabled={uploading || !pdfLibReady}
            />
          </label>
          {!pdfLibReady && !uploading && (
            <p className="text-xs text-gray-400 mt-2">Initializing PDF Processor...</p>
          )}
        </div>
      </div>

      {/* 2. Official Question Bank Import Section */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start space-x-3">
                <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                    <Database className="w-6 h-6" />
                </div>
                <div>
                    <h3 className="font-semibold text-gray-900">Official Question Bank Import</h3>
                    <p className="text-sm text-gray-500">Import raw JSON data (text file) from FS Quiz archives.</p>
                </div>
            </div>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
                 {bankLog.length > 0 && (
                     <button 
                        onClick={() => setShowBankLogs(!showBankLogs)}
                        className="text-gray-500 hover:text-gray-700 p-2"
                        title="Show Logs"
                     >
                         <List className="w-5 h-5" />
                     </button>
                 )}
                 <label className={`btn-secondary cursor-pointer flex items-center justify-center px-4 py-2 w-full sm:w-auto ${importingBank ? 'opacity-50 pointer-events-none' : ''}`}>
                    {importingBank ? <Loader className="w-4 h-4 animate-spin mr-2" /> : <FileJson className="w-4 h-4 mr-2" />}
                    {importingBank ? "Importing..." : "Import .txt File"}
                    <input 
                        type="file" 
                        accept=".txt,.json" 
                        className="hidden" 
                        onChange={handleQuestionBankUpload}
                        disabled={importingBank}
                    />
                 </label>
            </div>
        </div>

        {/* Import Logs Console */}
        {showBankLogs && bankLog.length > 0 && (
            <div className="mt-4 bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs h-40 overflow-y-auto">
                {bankLog.map((line, i) => (
                    <div key={i} className="border-b border-gray-800 py-1">{line}</div>
                ))}
            </div>
        )}
      </div>

      {/* 3. Documents List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">
            Uploaded Documents ({documents.length})
          </h2>
          
          {documents.length > 0 && (
            <div className="flex items-center space-x-2 text-xs sm:text-sm">
              <button
                onClick={selectAllDocuments}
                className="text-primary-600 hover:text-primary-700 whitespace-nowrap"
              >
                <span className="hidden sm:inline">Select All Valid</span>
                <span className="sm:hidden">All</span>
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={clearSelection}
                className="text-gray-600 hover:text-gray-700 whitespace-nowrap"
              >
                <span className="hidden sm:inline">Clear Selection</span>
                <span className="sm:hidden">Clear</span>
              </button>
            </div>
          )}
        </div>
        
        {documents.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-10 h-10 sm:w-12 sm:h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-sm sm:text-base text-gray-600">No documents uploaded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Upload your first training document to get started
            </p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border-2 rounded-lg transition-colors space-y-2 sm:space-y-0 ${
                  selectedDocuments.has(doc.id)
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start space-x-3 flex-1 cursor-pointer" onClick={() => toggleDocumentSelection(doc.id)}>
                  <button
                    className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedDocuments.has(doc.id)
                        ? 'border-primary-500 bg-primary-500'
                        : 'border-gray-300 hover:border-primary-400'
                    }`}
                  >
                    {selectedDocuments.has(doc.id) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </button>
                  <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 text-sm sm:text-base truncate">{doc.name}</h3>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(doc.file_size)} • Uploaded {formatDate(doc.created_at)}
                    </p>
                    {doc.content && !doc.content.startsWith('[PDF Document:') && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ Text extracted ({doc.content.length} chars)
                      </p>
                    )}
                    {doc.content && doc.content.startsWith('[PDF Document:') && (
                      <p className="text-xs text-orange-600 mt-1">
                        ⚠️ No text extracted - please re-upload
                      </p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-1 sm:space-x-2 self-end sm:self-center">
                  <button
                    onClick={() => handleDownload(doc)}
                    className="p-2 text-gray-600 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="p-2 text-gray-600 hover:text-danger-600 hover:bg-danger-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}