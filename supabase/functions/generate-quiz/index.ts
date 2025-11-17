import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('🎯 Quiz generation started');
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { count = 5, selectedDocuments } = await req.json();
    console.log('📊 Requested question count:', count);
    console.log('📋 Selected documents:', selectedDocuments?.length || 0);
    
    // Get documents for context
    console.log('📚 Fetching documents...');
    
    let documents;
    let docError;
    
    if (selectedDocuments && selectedDocuments.length > 0) {
      // Use only selected documents
      const { data: selectedDocs, error: selectedError } = await supabaseClient
        .from('documents')
        .select('content, name')
        .in('id', selectedDocuments);
      
      documents = selectedDocs;
      docError = selectedError;
      console.log('📄 Using selected documents');
    } else {
      // Use all documents
      const { data: allDocs, error: allError } = await supabaseClient
        .from('documents')
        .select('content, name')
        .limit(10);
      
      documents = allDocs;
      docError = allError;
      console.log('📄 Using all available documents');
    }
    
    if (docError) {
      console.error('❌ Error fetching documents:', docError);
      return getFallbackQuestions(count);
    }
    console.log('📄 Documents fetched:', documents?.length || 0);
    // Filter out documents with placeholder content
    const validDocs = documents?.filter((doc)=>doc.content && doc.content.trim().length > 100 && !doc.content.startsWith('[PDF Document:')) || [];
    console.log('✅ Valid documents:', validDocs.length);
    if (validDocs.length > 0) {
      console.log('📋 Document names:', validDocs.map((d)=>d.name).join(', '));
    }
    if (validDocs.length === 0) {
      console.log('⚠️ No valid documents found, returning fallback questions');
      return getFallbackQuestions(count);
    }
    // Combine context with reasonable size limit
    const context = validDocs.map((doc)=>doc.content).join('\n\n').substring(0, 15000);
    console.log('📝 Context length:', context.length);
    console.log('🔤 Context preview:', context.substring(0, 200));
    // Check if Gemini API key exists
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment');
      return getFallbackQuestions(count);
    }
    console.log('🔑 Gemini API key found');
    // Generate questions using Gemini
    console.log('🤖 Generating questions with Gemini...');
    try {
      const questions = await generateQuestionsWithGemini(context, count);
      console.log('✅ Questions generated:', questions.length);
      // If we got fewer questions than requested, that's okay
      if (questions.length < count) {
        console.log(`⚠️ Generated ${questions.length} out of ${count} requested`);
      }
      return new Response(JSON.stringify({
        questions,
        source: 'gemini',
        contextUsed: context.length,
        requested: count,
        generated: questions.length
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    } catch (geminiError) {
      console.error('❌ Gemini generation failed:', geminiError.message);
      return getFallbackQuestions(count);
    }
  } catch (error) {
    console.error('❌ Quiz generation error:', error);
    console.error('Error details:', error.message);
    return getFallbackQuestions(5);
  }
});
async function generateQuestionsWithGemini(context, count) {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    console.log('🔧 Initializing Gemini...');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8000
      }
    });
    const prompt = `Generate exactly ${count} Formula Student quiz questions in valid JSON format.

CONTEXT:
${context.substring(0, 10000)}

CRITICAL: Return ONLY a JSON array. No markdown, no explanations, just the array.

Format:
[
  {
    "type": "multiple_choice",
    "question": "Question?",
    "options": ["A", "B", "C", "D"],
    "correct_answer": 0,
    "explanation": "Explanation",
    "difficulty": "medium"
  }
]

Requirements:
- Exactly ${count} questions
- Each question must be complete and valid
- Mix of multiple_choice and true_false types
- Base questions on the Formula Student rules context
- Return ONLY the JSON array`;
    console.log('📤 Sending prompt for', count, 'questions...');
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    console.log('📥 Response length:', response.length);
    console.log('📝 Response preview:', response.substring(0, 500));
    // Extract and fix JSON
    let cleanedResponse = response.replace(/```json/g, '').replace(/```/g, '').trim();
    // Find JSON array boundaries
    const startIndex = cleanedResponse.indexOf('[');
    const endIndex = cleanedResponse.lastIndexOf(']');
    if (startIndex === -1 || endIndex === -1) {
      console.error('❌ No array brackets found');
      throw new Error('No JSON array in response');
    }
    cleanedResponse = cleanedResponse.substring(startIndex, endIndex + 1);
    // Fix common JSON issues
    cleanedResponse = fixCommonJsonIssues(cleanedResponse);
    console.log('🧹 Cleaned JSON length:', cleanedResponse.length);
    // Try parsing
    let questions;
    try {
      questions = JSON.parse(cleanedResponse);
      console.log('✅ Parsed successfully:', questions.length, 'questions');
    } catch (parseError) {
      console.error('❌ Parse error:', parseError.message);
      // Try to salvage partial results
      questions = tryPartialParse(cleanedResponse);
      if (!questions || questions.length === 0) {
        console.error('Failed JSON preview:', cleanedResponse.substring(0, 500));
        throw new Error(`JSON parse failed: ${parseError.message}`);
      }
      console.log('⚠️ Partial parse successful:', questions.length, 'questions');
    }
    if (!Array.isArray(questions)) {
      throw new Error('Response is not an array');
    }
    if (questions.length === 0) {
      throw new Error('No questions in array');
    }
    console.log('✅ Final question count:', questions.length);
    // Validate and normalize
    const validQuestions = questions.filter((q)=>q.question && q.type) // Filter out invalid entries
    .map((q, index)=>{
      let correctAnswer = q.correct_answer;
      if (q.type === 'true_false') {
        correctAnswer = correctAnswer === true || correctAnswer === 'true' || correctAnswer === 1;
      } else if (q.type === 'multiple_choice') {
        correctAnswer = typeof correctAnswer === 'number' ? correctAnswer : parseInt(correctAnswer) || 0;
      }
      return {
        id: (index + 1).toString(),
        type: q.type,
        question: q.question,
        options: q.options || [],
        correct_answer: correctAnswer,
        explanation: q.explanation || 'Refer to Formula Student rules',
        difficulty: q.difficulty || 'medium'
      };
    });
    if (validQuestions.length === 0) {
      throw new Error('No valid questions after filtering');
    }
    console.log('✅ Valid questions:', validQuestions.length);
    return validQuestions;
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  }
}
// Fix common JSON formatting issues
function fixCommonJsonIssues(jsonStr) {
  return jsonStr// Remove trailing commas before ] or }
  .replace(/,(\s*[}\]])/g, '$1')// Remove any null bytes or control characters
  .replace(/[\x00-\x1F\x7F]/g, '');
}
// Try to parse partial JSON if full parse fails
function tryPartialParse(jsonStr) {
  try {
    // Try to find complete question objects
    const questionMatches = jsonStr.match(/\{[^{}]*"type"[^{}]*"question"[^{}]*\}/g);
    if (!questionMatches || questionMatches.length === 0) {
      return null;
    }
    console.log('🔧 Found', questionMatches.length, 'potential question objects');
    const questions = [];
    for (const match of questionMatches){
      try {
        const q = JSON.parse(match);
        if (q.type && q.question) {
          questions.push(q);
        }
      } catch (e) {
        continue;
      }
    }
    return questions.length > 0 ? questions : null;
  } catch (error) {
    console.error('Partial parse failed:', error.message);
    return null;
  }
}
function getFallbackQuestions(count) {
  console.log('⚠️ Returning fallback questions');
  const fallbackQuestions = [
    {
      id: '1',
      type: 'multiple_choice',
      question: 'What is the maximum engine displacement allowed in Formula Student?',
      options: [
        '610cc',
        '650cc',
        '710cc',
        '750cc'
      ],
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
    },
    {
      id: '3',
      type: 'multiple_choice',
      question: 'Which of the following is required for Formula Student vehicle inspection?',
      options: [
        'Roll cage',
        'Fire extinguisher',
        'Driver harness',
        'All of the above'
      ],
      correct_answer: 3,
      explanation: 'All safety equipment including roll cage, fire extinguisher, and driver harness are required.',
      difficulty: 'easy'
    }
  ];
  const selected = fallbackQuestions.slice(0, Math.min(count, fallbackQuestions.length));
  return new Response(JSON.stringify({
    questions: selected,
    source: 'fallback',
    reason: 'Gemini generation failed or no documents available',
    requested: count,
    generated: selected.length
  }), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    status: 200
  });
}
