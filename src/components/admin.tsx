import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader, CheckCircle, AlertCircle } from 'lucide-react';

export default function AdminImporter() {
  const [rawData, setRawData] = useState('');
  const [status, setStatus] = useState('idle'); // idle, processing, uploading, done, error
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const processAndUpload = async () => {
    setStatus('processing');
    setLogs([]);
    
    try {
      // 1. Split the massive text by "QUIZ {number}"
      // This regex looks for the word QUIZ followed by a number
      const parts = rawData.split(/QUIZ \d+/).filter(part => part.trim().length > 0);
      
      addLog(`Found ${parts.length} potential quiz blocks.`);
      
      let allQuestionsToInsert = [];

      for (let i = 0; i < parts.length; i++) {
        let jsonStr = parts[i].trim();
        
        try {
          // Clean up common OCR/Text errors before parsing
          // This replaces actual line breaks with spaces to prevent JSON parse errors
          // But keeps explicit \n characters
          jsonStr = jsonStr.replace(/(?:\r\n|\r|\n)/g, ' '); 
          
          const quiz = JSON.parse(jsonStr);
          
          // Extract Event Name safely
          const eventName = quiz.event && quiz.event[0] ? quiz.event[0].short_name : 'Unknown';

          // Process questions for this quiz
          const quizQuestions = quiz.questions.map((q: any) => {
            // Extract solution text if it exists
            const explanation = q.solution && q.solution[0] ? q.solution[0].text : null;
            
            return {
              external_id: q.question_id,
              quiz_id: quiz.quiz_id,
              year: parseInt(quiz.year) || 0,
              class: quiz.class,
              source_event: eventName,
              type: q.type,
              question_text: q.text,
              options: q.answers, // Store raw answers array
              images: q.images,   // Store raw images array
              explanation: explanation
            };
          });

          allQuestionsToInsert.push(...quizQuestions);
          addLog(`Parsed Quiz ${quiz.quiz_id}: ${quizQuestions.length} questions.`);

        } catch (e) {
          console.error("JSON Error on block", i, e);
          addLog(`❌ Error parsing Quiz block ${i + 1}: ${e.message}`);
        }
      }

      addLog(`Total questions prepared: ${allQuestionsToInsert.length}`);
      setStatus('uploading');

      // 2. Upload in batches of 50 to prevent timeout
      const BATCH_SIZE = 50;
      for (let i = 0; i < allQuestionsToInsert.length; i += BATCH_SIZE) {
        const batch = allQuestionsToInsert.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('question_bank').insert(batch);
        
        if (error) throw error;
        addLog(`✅ Uploaded batch ${i} to ${i + batch.length}`);
      }

      setStatus('done');
      alert("Import Complete!");

    } catch (error: any) {
      console.error(error);
      addLog(`🔥 CRITICAL ERROR: ${error.message}`);
      setStatus('error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">FS Quiz Data Importer</h1>
      
      <div className="mb-4">
        <label className="block text-sm font-bold mb-2">Paste Raw Content Here:</label>
        <textarea 
          value={rawData}
          onChange={(e) => setRawData(e.target.value)}
          className="w-full h-64 p-2 border rounded font-mono text-xs"
          placeholder="Paste the entire text file content starting with QUIZ 1..."
        />
      </div>

      <button 
        onClick={processAndUpload}
        disabled={status !== 'idle' || !rawData}
        className="bg-blue-600 text-white px-6 py-3 rounded disabled:opacity-50 flex items-center"
      >
        {status === 'processing' && <Loader className="animate-spin mr-2" />}
        {status === 'idle' ? 'Parse & Upload to DB' : status}
      </button>

      <div className="mt-6 bg-gray-100 p-4 rounded h-64 overflow-y-auto font-mono text-sm">
        {logs.map((log, i) => (
          <div key={i} className="border-b border-gray-200 py-1">{log}</div>
        ))}
      </div>
    </div>
  );
}