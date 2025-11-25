import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // 1. Parse the input
    const payload = await req.json();
    console.log("📝 Feedback Request Mode:", payload.mode || "team (legacy)");
    let result;
    // 2. Branch Logic based on Mode
    if (payload.mode === 'individual') {
      // --- NEW INDIVIDUAL LOGIC ---
      if (!payload.questions || payload.score === undefined) {
        throw new Error('Questions and Score are required for individual mode');
      }
      result = await generateIndividualFeedback(payload.questions, payload.answers, payload.score, payload.totalQuestions);
    } else {
      // --- EXISTING TEAM LOGIC (Preserved) ---
      // Fallback for existing team challenge calls that send { scores, questions }
      const scores = payload.scores;
      const questions = payload.questions;
      if (!scores || !questions) {
        throw new Error('Scores and Questions are required for team analysis');
      }
      result = await generateGameFeedback(scores, questions);
    }
    // 3. Return as JSON
    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Feedback generation error:', error);
    // Fallback Response
    return new Response(JSON.stringify({
      summary: "Feedback unavailable.",
      strengths: [
        "Quiz Completed"
      ],
      weak_points: [],
      detailed_analysis: "Unable to generate AI analysis at this time. Please review your score above.",
      feedback: "Unable to generate AI analysis at this time." // Fallback for simple UI
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  }
});
// ==========================================
// 1. NEW: INDIVIDUAL QUIZ FEEDBACK
// ==========================================
async function generateIndividualFeedback(questions, userAnswers, score, total) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Gemini API key not configured');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: {
      responseMimeType: "application/json"
    }
  });
  // Prepare data summary for AI
  const percentage = Math.round(score / total * 100);
  // Map questions to topics/concepts
  const questionSummary = questions.map((q, index)=>{
    const userAnswer = userAnswers[index];
    // Determine correctness based on type
    let isCorrect = false;
    if (q.type === 'single_choice') isCorrect = Number(userAnswer) === Number(q.correct_answer);
    else if (q.type === 'multi_choice') isCorrect = JSON.stringify(Array.isArray(userAnswer) ? userAnswer.sort() : []) === JSON.stringify(Array.isArray(q.correct_answer) ? q.correct_answer.sort() : []);
    else if (q.type === 'input') isCorrect = String(userAnswer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
    return {
      question: q.question.substring(0, 50) + "...",
      topic: detectTopic(q.question),
      correct: isCorrect
    };
  });
  const prompt = `
      Analyze this individual Formula Student engineering quiz performance.
      
      STATS:
      - Score: ${score} / ${total} (${percentage}%)
      - Performance Data: ${JSON.stringify(questionSummary)}

      TASK:
      Act as a Formula Student Faculty Advisor. Provide a brief, encouraging, but technical critique.
      Identify which topics they know well vs what they need to study (Rulebook, Engineering Calculation, etc.).

      OUTPUT FORMAT (Strict JSON):
      {
        "summary": "One sentence summary of the performance.",
        "strengths": ["Short bullet point 1", "Short bullet point 2"],
        "weak_points": ["Short bullet point 1", "Short bullet point 2"],
        "feedback": "A short paragraph (approx 3 sentences) giving specific advice based on the missed questions.",
        "detailed_analysis": "Same as feedback" 
      }
    `;
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
// ==========================================
// 2. EXISTING: TEAM GAME FEEDBACK
// ==========================================
async function generateGameFeedback(scores, questions) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Gemini API key not configured');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-latest',
    generationConfig: {
      responseMimeType: "application/json"
    }
  });
  const team1Score = scores['1'] || 0;
  const team2Score = scores['2'] || 0;
  // Extract Topics
  const allQuestions = [
    ...questions['1'] || [],
    ...questions['2'] || []
  ];
  const topicSet = new Set();
  allQuestions.forEach((q)=>{
    topicSet.add(detectTopic(q.question));
  });
  const topics = Array.from(topicSet).join(', ');
  const prompt = `
    Analyze this Formula Student quiz match between two teams.
    
    DATA:
    - Team 1 Score: ${team1Score} points
    - Team 2 Score: ${team2Score} points
    - Topics Covered: ${topics}
    - Total Questions: ${allQuestions.length}

    TASK:
    Act as a Formula Student Judge giving a post-game debrief. 
    Compare the performance. If scores are low, assume the questions were difficult rules questions. 
    If scores are high, commend their rulebook knowledge.

    OUTPUT FORMAT (Strict JSON):
    {
      "summary": "A 2-sentence overview of who won and the general difficulty level.",
      "strengths": ["Short bullet point 1", "Short bullet point 2"],
      "weak_points": ["Short bullet point 1", "Short bullet point 2"],
      "detailed_analysis": "A paragraph offering advice on the topics mentioned above."
    }
  `;
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
// Helper to tag topics (Shared between both modes)
function detectTopic(questionText) {
  const text = questionText.toLowerCase();
  if (text.includes('brake') || text.includes('stopping')) return 'Braking';
  if (text.includes('engine') || text.includes('intake') || text.includes('fuel') || text.includes('motor') || text.includes('power')) return 'Powertrain';
  if (text.includes('chassis') || text.includes('frame') || text.includes('tube') || text.includes('hoop')) return 'Chassis/Structural';
  if (text.includes('suspension') || text.includes('tire') || text.includes('wheel') || text.includes('spring') || text.includes('damper')) return 'Suspension/VD';
  if (text.includes('electrical') || text.includes('battery') || text.includes('voltage') || text.includes('accumulator') || text.includes('tsal') || text.includes('bspd')) return 'EV/Electronics';
  if (text.includes('aero') || text.includes('wing') || text.includes('drag') || text.includes('downforce')) return 'Aerodynamics';
  if (text.includes('cost') || text.includes('business') || text.includes('presentation')) return 'Static Events';
  return 'General Rules';
}
