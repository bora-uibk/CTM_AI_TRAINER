import React, { useState, useEffect } from 'react'
import { supabase, Document } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Upload, FileText, Download, Trash2, CircleAlert as AlertCircle, CircleCheck as CheckCircle, Loader } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist/build/pdf'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'

// Set up the PDF.js worker using Vite's bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

export default function Documents() {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    fetchDocuments()
  }, [])

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
      showMessage('error', 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  // Extract text from PDF
  const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
      setUploadProgress('Reading PDF file...')
      const arrayBuffer = await file.arrayBuffer()
      
      setUploadProgress('Loading PDF document...')
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      
      let fullText = ''
      const totalPages = pdf.numPages
      
      setUploadProgress(`Extracting text from ${totalPages} pages...`)
      
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        setUploadProgress(`Processing page ${pageNum} of ${totalPages}...`)
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ')
        fullText += pageText + '\n\n'
      }
      
      const trimmedText = fullText.trim()
      console.log(`✅ Extracted ${trimmedText.length} characters from PDF`)
      
      if (trimmedText.length < 100) {
        throw new Error('PDF appears to be empty or contains very little text')
      }
      
      return trimmedText
    } catch (error: any) {
      console.error('PDF extraction error:', error)
      throw new Error(`Failed to extract text from PDF: ${error.message}`)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !user) return

    setUploading(true)
    setUploadProgress('Starting upload...')
    
    try {
      // Step 1: Extract text content
      let textContent = ''
      
      if (file.type === 'application/pdf') {
        textContent = await extractTextFromPDF(file)
      } else if (file.type.includes('text/')) {
        setUploadProgress('Reading text file...')
        textContent = await file.text()
      } else {
        throw new Error('Unsupported file type. Please upload PDF or TXT files.')
      }

      console.log(`Text content length: ${textContent.length} characters`)

      // Step 2: Upload file to Supabase Storage
      setUploadProgress('Uploading file to storage...')
      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}.${fileExt}`
      const filePath = `documents/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Step 3: Process document with edge function
      setUploadProgress('Processing document and generating embeddings...')

      // LOG THE PAYLOAD BEFORE SENDING
      console.log('📤 Sending to edge function:', {
        name: file.name,
        contentLength: textContent.length,
        contentPreview: textContent.substring(0, 100),
        file_path: filePath,
        file_size: file.size,
        mime_type: file.type,
      })
      
      const { data, error: processError } = await supabase.functions.invoke('process-document', {
        body: {
          name: file.name,
          content: textContent, // Send the actual extracted text!
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
        }
      })
      
      console.log('📥 Response from edge function:', data)
      
      if (processError) throw processError

      showMessage('success', `✅ Document processed! Extracted ${textContent.length} characters.`)
      fetchDocuments()
    } catch (error: any) {
      console.error('Error uploading document:', error)
      showMessage('error', error.message || 'Failed to upload document')
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
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Uploaded Documents ({documents.length})
        </h2>
        
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
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors space-y-3 sm:space-y-0"
              >
                <div className="flex items-start sm:items-center space-x-3 flex-1">
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