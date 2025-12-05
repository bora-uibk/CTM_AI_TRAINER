import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🎯 Quiz generation started');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { count = 5, selectedDocuments } = await req.json();
    
    console.log('📊 Requested question count:', count);
    console.log('📋 Selected documents:', selectedDocuments?.length || 0);

    // Get documents for context
    console.log('📚 Fetching documents...');
    let documents;
    let docError;

    if (selectedDocuments && selectedDocuments.length > 0) {
      const { data: selectedDocs, error: selectedError } = await supabaseClient
        .from('documents')
        .select('content, name')
        .in('id', selectedDocuments);
      documents = selectedDocs;
      docError = selectedError;
    } else {
      const { data: allDocs, error: allError } = await supabaseClient
        .from('documents')
        .select('content, name')
        .limit(10);
      documents = allDocs;
      docError = allError;
    }

    if (docError) {
      console.error('❌ Error fetching documents:', docError);
      return getFallbackQuestions(count);
    }

    // Filter out invalid docs
    const validDocs = documents?.filter(doc => 
      doc.content && 
      doc.content.trim().length > 50
    ) || [];

    if (validDocs.length === 0) {
      return getFallbackQuestions(count);
    }

    // Combine context. Increased limit to 150k chars to accommodate Rulebooks + Quiz History
    // Gemini Flash has a large context window, so we can pass more data.
    const context = validDocs.map(doc => 
      `--- DOCUMENT: ${doc.name} ---\n${doc.content}`
    ).join('\n\n').substring(0, 150000); 

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return getFallbackQuestions(count);
    }

    try {
      const questions = await generateQuestionsWithGemini(context, count);
      return new Response(JSON.stringify({
        questions,
        source: 'gemini',
        requested: count,
        generated: questions.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    } catch (geminiError) {
      console.error('❌ Gemini generation failed:', geminiError.message);
      return getFallbackQuestions(count);
    }

  } catch (error) {
    console.error('❌ Quiz generation error:', error.message);
    return getFallbackQuestions(5);
  }
});

async function generateQuestionsWithGemini(context, count) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Use 1.5 Flash for larger context window and faster speed
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest', 
    generationConfig: {
      temperature: 0.5, // Lower temperature for more accurate rule-based questions
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8000,
      responseMimeType: "application/json"
    }
  });

  const prompt = `You are an expert engineering exam creator for Formula Student competitions.
    Generate exactly ${count} questions based ONLY on the provided documents.
    
    INPUT CONTEXT:
    ${context}

    INSTRUCTIONS:
    1. Analyze the documents. If a "Rulebook" is provided, prioritize it for factual rules. If "Accounting/Cost" docs are provided, create calculation or logic questions based on them. If "Past Quizzes" are provided, use them to understand the *difficulty* and *style* but do not copy them word-for-word unless they are relevant rules.
    2. Create questions in the following specific styles found in Formula Student competitions:
       
       - TYPE A: "single_choice" (Standard multiple choice. One correct answer).
         * Focus on Rule compliance, specific dimensions, materials, or definitions.
       
       - TYPE B: "multi_choice" (Select ALL that apply).
         * Focus on complex rules where multiple conditions must be met (e.g., "Which statements are TRUE regarding scrutineering?").
       
       - TYPE C: "input" (Numerical Calculation or Specific Value).
         * Create engineering scenarios (e.g., Calculate stress, voltage, skidpad scoring, efficiency scores).
         * Provide variables and ask for a specific number.
         * IMPORTANT: For 'input' types, the "options" array should be empty [], and "correct_answer" should be the string representation of the calculated number (e.g., "12.34").

    3. DIFFICULTY: Mix between Medium and Hard. Avoid trivial questions.
    4. OUTPUT FORMAT: Return a raw JSON Array.

    JSON SCHEMA:
    [
      {
        "type": "single_choice" | "multi_choice" | "input",
        "question": "The question text. If it's a calculation, include units required.",
        "options": ["Option A", "Option B", "Option C", "Option D"], // Empty [] for 'input' type
        "correct_answer": 0, // For single_choice: Index of the answer (0-3). 
                             // For multi_choice: Array of indices [0, 2]. 
                             // For input: The string value answer "125.5".
        "explanation": "Detailed derivation or rule reference (e.g., 'According to T.1.2...').",
        "difficulty": "hard"
      }
    ]
  `;

  console.log(`📤 Sending prompt to Gemini...`);
  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Clean and Parse JSON
  let cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
  
  try {
    let questions = JSON.parse(cleanedResponse);
    
    if (!Array.isArray(questions)) throw new Error("Response is not an array");

    // Normalize and Validate
    return questions.map((q, index) => {
      let safeType = q.type;
      let safeAnswer = q.correct_answer;

      // Normalize Types
      if (!['single_choice', 'multi_choice', 'input'].includes(safeType)) {
        safeType = 'single_choice';
      }

      // Normalize Answers based on type
      if (safeType === 'input') {
        // Ensure options is empty for input
        q.options = []; 
        // Ensure answer is a string
        safeAnswer = String(safeAnswer); 
      } 
      else if (safeType === 'multi_choice') {
        // Ensure answer is an array of numbers
        if (!Array.isArray(safeAnswer)) {
           safeAnswer = [Number(safeAnswer) || 0];
        }
      } 
      else {
        // Single choice defaults
        safeAnswer = Number(safeAnswer);
        if (isNaN(safeAnswer)) safeAnswer = 0;
      }

      return {
        id: Date.now() + index.toString(),
        type: safeType,
        question: q.question,
        options: q.options || [],
        correct_answer: safeAnswer,
        explanation: q.explanation || 'Based on the provided documents.',
        difficulty: q.difficulty || 'medium'
      };
    });

  } catch (error) {
    console.error('❌ JSON Parse Error:', error);
    console.log('Raw Output:', responseText);
    throw error;
  }
}

function getFallbackQuestions(count) {
  console.log('⚠️ Returning fallback questions');
  const fallback = [
    {
      id: 'fb1',
      type: 'single_choice',
      question: 'According to general FS rules, what is the maximum displacement for a combustion engine?',
      options: ['500cc', '600cc', '710cc', 'Unlimited'],
      correct_answer: 2,
      explanation: 'Standard rules typically limit FSAE engines to 710cc.',
      difficulty: 'medium'
    },
    {
      id: 'fb2',
      type: 'input',
      question: 'Calculate the points for a Skidpad run of 5.0s if the best time is 4.8s. (Formula: 3.5 + 3.5 * ( (Tmax/Tyour)^2 - 1 ) / ( (Tmax/Tmin)^2 - 1 ) ). Assume Tmax is 1.25*Tmin. Answer to 2 decimal places.',
      options: [],
      correct_answer: "42.50",
      explanation: 'Using the standard scoring formula for skidpad.',
      difficulty: 'hard'
    },
    {
      id: 'fb3',
      type: 'multi_choice',
      question: 'Which of the following are required for the Impact Attenuator Data (IAD) submission?',
      options: ['Test velocity > 7 m/s', 'Average deceleration < 20g', 'Peak deceleration < 40g', 'Energy absorbed > 7350J'],
      correct_answer: [0, 1, 2, 3],
      explanation: 'These are standard IAD requirements.',
      difficulty: 'medium'
    }
  ];
  return new Response(JSON.stringify({
    questions: fallback.slice(0, count),
    source: 'fallback'
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}