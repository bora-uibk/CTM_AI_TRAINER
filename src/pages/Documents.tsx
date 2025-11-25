import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Upload, FileText, Download, Trash2, Loader, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Check, Settings } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

// --- FIX: Update worker URL for pdfjs-dist v5+ ---
// Version 5+ uses .mjs (ES Modules) for the worker.
// We use 'unpkg' to ensure we get the exact matching version and the correct file extension.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

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
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchDocuments()
    loadSelectedDocuments()
  }, [])

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
    return new Promise(async (resolve, reject) => {
      try {
        const arrayBuffer = await file.arrayBuffer()
        
        // Load the PDF document
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        const pdf = await loadingTask.promise
        
        let fullText = ''
        const totalPages = pdf.numPages

        // Iterate through every page
        for (let i = 1; i <= totalPages; i++) {
          const page = await pdf.getPage(i)
          const textContent = await page.getTextContent()
          
          // Extract text items and add spaces/newlines
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ')
          
          // Add explicit page markers for the AI to reference later
          fullText += `\n--- Page ${i} ---\n${pageText}\n`
        }

        if (fullText.trim().length > 0) {
          resolve(fullText)
        } else {
          resolve(`[PDF Document: ${file.name}] - No selectable text found. This might be a scanned image.`)
        }
      } catch (error) {
        console.error('PDF parsing error:', error)
        // Fallback: resolve with empty string or error message so upload doesn't hang
        resolve(`[PDF Document: ${file.name}] - Failed to parse PDF structure. Error: ${(error as any).message}`)
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

    // Validate file type
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
    
    // Store in localStorage for other components to access
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 px-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Training Documents</h1>
          <p className="text-gray-600 mt-1">
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
        <div className={`p-4 rounded-lg flex items-center space-x-2 ${
          message.type === 'success' 
            ? 'bg-success-50 border border-success-200' 
            : 'bg-danger-50 border border-danger-200'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 text-success-600" />
          ) : (
            <AlertCircle className="w-5 h-5 text-danger-600" />
          )}
          <span className={message.type === 'success' ? 'text-success-700' : 'text-danger-700'}>
            {message.text}
          </span>
        </div>
      )}

      {/* Upload Section */}
      <div className="card">
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-8 text-center hover:border-primary-400 transition-colors">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
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
          <label className="btn-primary cursor-pointer inline-block">
            {uploading ? (
              <span className="flex items-center space-x-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </span>
            ) : (
              'Choose File'
            )}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.txt"
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Documents List */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Uploaded Documents ({documents.length})
          </h2>
          
          {documents.length > 0 && (
            <div className="flex items-center space-x-2">
              <button
                onClick={selectAllDocuments}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Select All Valid
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={clearSelection}
                className="text-sm text-gray-600 hover:text-gray-700"
              >
                Clear Selection
              </button>
            </div>
          )}
        </div>
        
        {documents.length === 0 ? (
          <div className="text-center py-8">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No documents uploaded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Upload your first training document to get started
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border-2 rounded-lg transition-colors space-y-3 sm:space-y-0 ${
                  selectedDocuments.has(doc.id)
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start sm:items-center space-x-3 flex-1 cursor-pointer" onClick={() => toggleDocumentSelection(doc.id)}>
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
                  <FileText className="w-8 h-8 text-primary-600 flex-shrink-0" />
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
                
                <div className="flex items-center space-x-2 self-end sm:self-center">
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