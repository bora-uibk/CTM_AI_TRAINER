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
      model: 'gemini-2.0-flash-exp',  // Updated model name
      generationConfig: {
        temperature: 0.7,  // Lower temperature for more consistent JSON
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4000,
        responseMimeType: "application/json"  // Force JSON response
      }
    });

    const prompt = `Generate ${count} Formula Student quiz questions based on this context. Return ONLY a valid JSON array.

CONTEXT:
${context}

Return this exact JSON structure:
[
  {
    "type": "multiple_choice",
    "question": "Question text?",
    "options": ["A", "B", "C", "D"],
    "correct_answer": 0,
    "explanation": "Why this is correct",
    "difficulty": "medium"
  },
  {
    "type": "true_false",
    "question": "Statement",
    "correct_answer": true,
    "explanation": "Explanation",
    "difficulty": "easy"
  }
]

Rules:
- ${count} questions total
- Mix of multiple_choice and true_false
- correct_answer: index (0-3) for multiple_choice, boolean for true_false
- Use difficulty: "easy", "medium", or "hard"
- Base questions on the provided context
- Return ONLY the JSON array, no other text`;

    console.log('📤 Sending prompt to Gemini...');
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    
    console.log('📥 Gemini response length:', response.length);
    console.log('📝 Full Gemini response:', response);  // Log the full response

    // Multiple cleaning strategies
    let cleanedResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^[^[{]*/, '')  // Remove anything before first [ or {
      .replace(/[^}\]]*$/, '')  // Remove anything after last } or ]
      .trim();

    console.log('🧹 Cleaned response:', cleanedResponse);

    // Try to parse
    let questions;
    try {
      questions = JSON.parse(cleanedResponse);
      console.log('✅ Direct parse successful');
    } catch (parseError) {
      console.log('⚠️ Direct parse failed, trying to extract array...');
      
      // Try to find JSON array using regex
      const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('❌ No JSON array found in response');
        console.error('Full cleaned response:', cleanedResponse);
        throw new Error('No valid JSON array found in Gemini response');
      }
      
      try {
        questions = JSON.parse(jsonMatch[0]);
        console.log('✅ Regex extraction parse successful');
      } catch (regexParseError) {
        console.error('❌ Regex parse also failed');
        console.error('Extracted JSON:', jsonMatch[0]);
        throw new Error('Could not parse JSON from Gemini response');
      }
    }

    if (!Array.isArray(questions)) {
      console.error('❌ Response is not an array:', typeof questions);
      throw new Error('Gemini response is not an array');
    }

    console.log('✅ Parsed questions:', questions.length);

    // Validate and normalize questions
    return questions.map((q, index) => {
      // Ensure correct_answer is properly typed
      let correctAnswer = q.correct_answer;
      if (q.type === 'true_false') {
        correctAnswer = correctAnswer === true || correctAnswer === 'true' || correctAnswer === 1;
      } else {
        correctAnswer = parseInt(correctAnswer);
      }

      return {
        id: (index + 1).toString(),
        type: q.type || 'multiple_choice',
        question: q.question,
        options: q.options || [],
        correct_answer: correctAnswer,
        explanation: q.explanation || 'No explanation provided',
        difficulty: q.difficulty || 'medium'
      };
    });
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
