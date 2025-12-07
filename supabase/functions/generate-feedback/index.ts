import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  console.log("-> 1. START: Request received.");
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log("-> 2. Payload parsed successfully.");
    
    // Default missing mode to "team" for backward compatibility
    const mode = payload.mode?.toLowerCase() || "team";
    console.log(`-> 3. Mode detected: ${mode.toUpperCase()}`);

    let result;
    const startTime = Date.now();

    // ===========================
    // Individual Mode
    // ===========================
    if (mode === 'individual') {
      if (!payload.questions || !payload.answers || payload.score === undefined) {
        throw new Error("Questions, Answers, and Score are required for individual mode");
      }
      result = await generateIndividualFeedback(
        payload.questions,
        payload.answers,
        payload.score,
        payload.totalQuestions
      );
    }

    // ===========================
    // Team Mode
    // ===========================
    else if (mode === 'team') {
      const scores = payload.scores;
      const questions = payload.questions;

      if (!scores || !questions) {
        throw new Error("Scores and Questions are required for team mode");
      }

      // Check if the input structure for questions is valid (must be an object)
      if (typeof questions !== 'object' || questions === null) {
          throw new Error("Questions payload must be a dictionary keyed by team number.");
      }

      result = await generateGameFeedback(scores, questions);
    }

    // ===========================
    // Invalid Mode
    // ===========================
    else {
      throw new Error(`Invalid mode '${mode}'. Must be 'team' or 'individual'`);
    }
    
    const duration = Date.now() - startTime;
    console.log(`-> 5. SUCCESS: Feedback generated and processed in ${duration}ms.`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("❌ 5. FAILURE: Feedback generation error:", error.message || error);

    // Fallback response for all errors
    return new Response(JSON.stringify({
      summary: "Feedback unavailable.",
      strengths: ["Quiz Completed"],
      weak_points: [],
      detailed_analysis: "Unable to generate AI analysis at this time. Please review your score above.",
      feedback: "Unable to generate AI analysis at this time."
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  }
});


// ===========================================
// Individual Quiz Feedback
// ===========================================
async function generateIndividualFeedback(questions, userAnswers, score, total) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Gemini API key not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });

  const totalQuestions = total || questions.length;
  const percentage = Math.round((score / totalQuestions) * 100);

  const questionSummary = questions.map((q, index) => {
    const userAnswer = userAnswers[index];
    let isCorrect = false;

    if (q.type === "single_choice") {
      isCorrect = Number(userAnswer) === Number(q.correct_answer);
    } else if (q.type === "multi_choice") {
      const a = (Array.isArray(userAnswer) ? userAnswer : []).map(String).sort();
      const b = (Array.isArray(q.correct_answer) ? q.correct_answer : []).map(String).sort();
      isCorrect = JSON.stringify(a) === JSON.stringify(b);
    } else if (q.type === "input") {
      isCorrect = String(userAnswer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
    }

    return {
      // Safely access the question text and detect topic
      question: (q.question && q.question.slice(0, 80) + "...") || "N/A",
      topic: detectTopic(q.question),
      correct: isCorrect
    };
  });

  const prompt = `
Analyze this individual Formula Student engineering quiz performance.

STATS:
- Score: ${score} / ${totalQuestions} (${percentage}%)
- Performance Data: ${JSON.stringify(questionSummary)}

TASK:
Act as a Formula Student Faculty Advisor. Provide brief, encouraging, technical feedback.
Identify topics they know well vs. what they need to study.

OUTPUT FORMAT (Strict JSON):
{
  "summary": "One sentence summary of the performance.",
  "strengths": [],
  "weak_points": [],
  "feedback": "A short paragraph (approx 3 sentences) with advice.",
  "detailed_analysis": "Same as feedback"
}
`;

  console.log("-> 4A. Starting individual mode AI generation...");
  const aiCallStart = Date.now();

  const raw = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  });
  
  const aiCallDuration = Date.now() - aiCallStart;
  console.log(`-> 4B. AI generation finished in ${aiCallDuration}ms. Proceeding to JSON parse.`);

  return safeJson(raw.response.text());
}


// ===========================================
// Team Game Feedback
// ===========================================
async function generateGameFeedback(scores, questions) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Gemini API key not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 2048,
    }
  });

  const team1Score = scores["1"] ?? 0;
  const team2Score = scores["2"] ?? 0;

  // Filter out any non-array/nullish inputs before spreading
  const team1Questions = Array.isArray(questions["1"]) ? questions["1"] : [];
  const team2Questions = Array.isArray(questions["2"]) ? questions["2"] : [];

  // Combine and filter out malformed questions (missing 'question' property)
  const allQuestions = [
    ...team1Questions,
    ...team2Questions
  ].filter(q => q && typeof q.question === 'string'); // CRITICAL: Only process valid question objects

  const topics = Array.from(new Set(allQuestions.map(q => detectTopic(q.question)))).join(", ");

  const prompt = `
You are a Formula Student technical judge providing post-game analysis.
Analyze this team quiz competition and provide constructive feedback.

GAME RESULTS:
- Team 1 Score: ${team1Score} points
- Team 2 Score: ${team2Score} points
- Topics Covered: ${topics || "General Formula Student Rules"}
- Total Questions: ${allQuestions.length}
- Winner: ${team1Score > team2Score ? 'Team 1' : team2Score > team1Score ? 'Team 2' : 'Tie'}

Provide encouraging but constructive feedback focusing on:
1. Overall performance analysis
2. Areas where both teams showed strength
3. Topics that need more study
4. Specific advice for improvement

Return ONLY valid JSON in this exact format:
{
  "summary": "Brief 1-2 sentence summary of the match results and overall performance",
  "strengths": ["Strength 1", "Strength 2", "Strength 3"],
  "weak_points": ["Area for improvement 1", "Area for improvement 2"],
  "detailed_analysis": "A paragraph offering advice on the topics."
}
`;
  
  console.log(`-> 4A. Starting team mode AI generation (Total Questions: ${allQuestions.length})`);

  const aiCallStart = Date.now();
  
  try {
    const raw = await model.generateContent(prompt);
    
    const aiCallDuration = Date.now() - aiCallStart;
    console.log(`-> 4B. AI generation finished in ${aiCallDuration}ms`);
    
    const rawText = raw.response.text();
    
    if (!rawText || rawText.trim().length === 0) {
      throw new Error(`AI response was empty after ${aiCallDuration}ms`);
    }

    const parsedJson = safeJson(rawText);

    // Ensure the team response object contains the 'feedback' property for backward compatibility
    return {
      ...parsedJson,
      feedback: parsedJson.detailed_analysis || parsedJson.summary || "Game completed successfully!"
    };
    
  } catch (error) {
    console.error(`AI generation failed: ${error.message}`);
    
    // Return a structured fallback response
    const winner = team1Score > team2Score ? 'Team 1' : team2Score > team1Score ? 'Team 2' : 'Both teams';
    return {
      summary: `${winner} performed well in this Formula Student quiz challenge.`,
      strengths: [
        "Teams demonstrated knowledge of Formula Student regulations",
        "Good competitive spirit and teamwork",
        "Engagement with technical content"
      ],
      weak_points: [
        "Continue studying Formula Student rulebook sections",
        "Practice more technical calculations",
        "Review competition regulations"
      ],
      detailed_analysis: `This was a competitive match with Team 1 scoring ${team1Score} points and Team 2 scoring ${team2Score} points. Both teams showed good understanding of Formula Student concepts. Continue practicing with the rulebook and technical materials to improve performance in future challenges.`,
      feedback: `Great job completing the team challenge! Team 1: ${team1Score} points, Team 2: ${team2Score} points. Keep studying the Formula Student regulations to improve your technical knowledge.`
    };
  }
}


// ===========================================
// Safe JSON Parsing Helper
// ===========================================
function safeJson(text) {
  try {
    // Clean up the text more thoroughly
    let cleanText = text.replace(/```json|```/g, "").trim();
    
    // Remove any leading/trailing non-JSON content
    const jsonStart = cleanText.indexOf('{');
    const jsonEnd = cleanText.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
    }
    
    console.log("-> 4C. Attempting to parse JSON...");
    const result = JSON.parse(cleanText);
    console.log("-> 4D. JSON parsed successfully.");
    return result;
  } catch (e) {
    console.error(`⚠️ JSON PARSE FAILED. Raw text length: ${text.length}. Error: ${e.message}`);
    console.error(`Raw text preview: ${text.substring(0, 200)}...`);
    
    return {
      summary: "Quiz completed successfully!",
      strengths: ["Completed the challenge", "Demonstrated Formula Student knowledge"],
      weak_points: ["Continue studying regulations", "Practice technical problems"],
      detailed_analysis: "Both teams showed good effort in this Formula Student quiz challenge. Keep practicing with the rulebook and technical materials.",
      feedback: "Great job completing the team challenge! Keep studying to improve your Formula Student knowledge."
    };
  }
}


// ===========================================
// Topic Detection Helper
// ===========================================
function detectTopic(questionText) {
  if (typeof questionText !== 'string') {
    return "Unknown/Malformed Question";
  }

  const text = questionText.toLowerCase();
  if (text.includes("brake") || text.includes("stopping")) return "Braking";
  if (text.includes("engine") || text.includes("fuel") || text.includes("power")) return "Powertrain";
  if (text.includes("chassis") || text.includes("frame")) return "Chassis/Structural";
  if (text.includes("suspension") || text.includes("tire") || text.includes("damper")) return "Suspension/VD";
  if (text.includes("battery") || text.includes("voltage") || text.includes("accumulator")) return "EV/Electronics";
  if (text.includes("aero") || text.includes("wing") || text.includes("drag")) return "Aerodynamics";
  if (text.includes("cost") || text.includes("presentation")) return "Static Events";
  return "General Rules";
}