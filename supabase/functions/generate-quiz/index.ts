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
    const { count = 5 } = await req.json();
    console.log('📊 Requested question count:', count);
    // Get documents for context
    console.log('📚 Fetching documents...');
    const { data: documents, error: docError } = await supabaseClient.from('documents').select('content, name').limit(10);
    if (docError) {
      console.error('❌ Error fetching documents:', docError);
      return getFallbackQuestions(count);
    }
    console.log('📄 Documents fetched:', documents?.length || 0);
    // Filter out documents with placeholder content
    const validDocs = documents?.filter((doc)=>doc.content && doc.content.trim().length > 100 && !doc.content.startsWith('[PDF Document:')) || [];
    console.log('✅ Valid documents:', validDocs.length);
    if (validDocs.length === 0) {
      console.log('⚠️ No valid documents found, returning fallback questions');
      return getFallbackQuestions(count);
    }
    // Combine context with reasonable size limit
    const context = validDocs.map((doc)=>doc.content).join('\n\n').substring(0, 15000) // Increased context size
    ;
    console.log('📝 Context length:', context.length);
    console.log('🔤 Context preview:', context.substring(0, 200));
    // Check if Gemini API key exists
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      console.error('❌ GEMINI_API_KEY not found in environment');
      return getFallbackQuestions(count);
    }
    console.log('🔑 Gemini API key found:', apiKey.substring(0, 10) + '...');
    // Generate questions using Gemini
    console.log('🤖 Generating questions with Gemini...');
    const questions = await generateQuestionsWithGemini(context, count);
    console.log('✅ Questions generated:', questions.length);
    return new Response(JSON.stringify({
      questions,
      source: 'gemini',
      contextUsed: context.length
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('❌ Quiz generation error:', error);
    console.error('Error details:', error.message, error.stack);
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
        temperature: 0.8,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 3000
      }
    });
    const prompt = `You are a Formula Student quiz generator. Based on the following Formula Student rules and documentation, generate ${count} diverse quiz questions.

CONTEXT FROM FORMULA STUDENT RULES:
${context}

Generate exactly ${count} questions in this JSON format (RETURN ONLY THE JSON ARRAY, NO OTHER TEXT):
[
  {
    "type": "multiple_choice",
    "question": "Specific question based on the rules?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Clear explanation citing the rules",
    "difficulty": "medium"
  },
  {
    "type": "true_false",
    "question": "Statement about the rules",
    "correct_answer": true,
    "explanation": "Explanation",
    "difficulty": "easy"
  }
]

REQUIREMENTS:
- Questions MUST be based on the provided context
- Mix of difficulty levels: easy (40%), medium (40%), hard (20%)
- Include mix of multiple_choice and true_false types
- correct_answer for multiple_choice is index (0-3)
- correct_answer for true_false is boolean
- All explanations must reference specific rules from the context
- Return ONLY valid JSON array, no markdown, no additional text`;
    console.log('📤 Sending prompt to Gemini...');
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    console.log('📥 Gemini response length:', response.length);
    console.log('📝 Gemini response preview:', response.substring(0, 300));
    // Clean up response - remove markdown code blocks if present
    let cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    console.log('🧹 Cleaned response:', cleanedResponse.substring(0, 200));
    // Try to extract JSON array
    const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('❌ No JSON array found in response');
      throw new Error('No valid JSON array found in Gemini response');
    }
    const questions = JSON.parse(jsonMatch[0]);
    console.log('✅ Parsed questions:', questions.length);
    // Validate and add IDs
    return questions.map((q, index)=>({
        id: (index + 1).toString(),
        type: q.type || 'multiple_choice',
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        difficulty: q.difficulty || 'medium'
      }));
  } catch (error) {
    console.error('❌ Error in generateQuestionsWithGemini:', error.message);
    console.error('Stack:', error.stack);
    throw error;
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
    },
    {
      id: '4',
      type: 'true_false',
      question: 'Formula Student vehicles can use any type of fuel without restrictions.',
      correct_answer: false,
      explanation: 'Formula Student has specific fuel regulations and restrictions for safety and fairness.',
      difficulty: 'medium'
    },
    {
      id: '5',
      type: 'multiple_choice',
      question: 'What is the typical weight range for a Formula Student car?',
      options: [
        '150-200kg',
        '200-300kg',
        '300-400kg',
        '400-500kg'
      ],
      correct_answer: 1,
      explanation: 'Most Formula Student cars weigh between 200-300kg including driver.',
      difficulty: 'hard'
    }
  ];
  const selected = fallbackQuestions.slice(0, Math.min(count, fallbackQuestions.length));
  return new Response(JSON.stringify({
    questions: selected,
    source: 'fallback',
    reason: 'Gemini generation failed or no documents available'
  }), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    status: 200
  });
}
