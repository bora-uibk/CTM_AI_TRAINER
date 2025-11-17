{
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
                <div className="flex items-start sm:items-center space-x-3 flex-1" onClick={() => toggleDocumentSelection(doc.id)}>
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