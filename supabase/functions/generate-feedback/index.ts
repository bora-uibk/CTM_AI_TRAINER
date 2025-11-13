import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { questions, answers, score, totalQuestions } = await req.json()

    if (!questions || !answers) {
      throw new Error('Questions and answers are required')
    }

    // Generate AI feedback based on performance
    const feedback = await generateFeedbackWithGemini(questions, answers, score, totalQuestions)

    return new Response(
      JSON.stringify({ feedback }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Feedback generation error:', error)
    
    // Return fallback feedback
    const fallbackFeedback = generateFallbackFeedback(score || 0, totalQuestions || 5)
    
    return new Response(
      JSON.stringify({ feedback: fallbackFeedback }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }
})

async function generateFeedbackWithGemini(questions: any[], answers: any[], score: number, totalQuestions: number) {
  try {
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      console.error('GEMINI_API_KEY not found')
      throw new Error('Gemini API key not configured')
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      }
    })

    // Analyze incorrect answers
    const incorrectAnswers = []
    const topicAreas = new Set()

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i]
      const userAnswer = answers[i]
      
      if (userAnswer !== question.correct_answer) {
        incorrectAnswers.push({
          question: question.question,
          userAnswer: question.type === 'multiple_choice' && question.options 
            ? question.options[userAnswer] || 'No answer'
            : userAnswer?.toString() || 'No answer',
          correctAnswer: question.type === 'multiple_choice' && question.options
            ? question.options[question.correct_answer]
            : question.correct_answer?.toString(),
          explanation: question.explanation,
          difficulty: question.difficulty
        })

        // Extract topic areas from questions
        const questionText = question.question.toLowerCase()
        if (questionText.includes('engine') || questionText.includes('motor') || questionText.includes('displacement')) {
          topicAreas.add('Engine and Powertrain')
        } else if (questionText.includes('brake') || questionText.includes('braking')) {
          topicAreas.add('Braking Systems')
        } else if (questionText.includes('safety') || questionText.includes('roll cage') || questionText.includes('harness')) {
          topicAreas.add('Safety Systems')
        } else if (questionText.includes('chassis') || questionText.includes('frame') || questionText.includes('structure')) {
          topicAreas.add('Chassis and Structure')
        } else if (questionText.includes('suspension') || questionText.includes('damper') || questionText.includes('spring')) {
          topicAreas.add('Suspension')
        } else if (questionText.includes('aero') || questionText.includes('wing') || questionText.includes('downforce')) {
          topicAreas.add('Aerodynamics')
        } else if (questionText.includes('electrical') || questionText.includes('wiring') || questionText.includes('battery')) {
          topicAreas.add('Electrical Systems')
        } else {
          topicAreas.add('General Rules and Regulations')
        }
      }
    }

    const percentage = Math.round((score / totalQuestions) * 100)
    
    const prompt = `As a Formula Student expert coach, provide personalized feedback for a student who scored ${score}/${totalQuestions} (${percentage}%) on a quiz.

Incorrect Answers Analysis:
${incorrectAnswers.map((item, index) => `
${index + 1}. Question: ${item.question}
   Student Answer: ${item.userAnswer}
   Correct Answer: ${item.correctAnswer}
   Explanation: ${item.explanation}
   Difficulty: ${item.difficulty}
`).join('')}

Areas that need improvement: ${Array.from(topicAreas).join(', ')}

Please provide:
1. Overall performance assessment
2. Specific areas for improvement based on incorrect answers
3. Study recommendations for the identified weak areas
4. Encouragement and next steps

Keep the feedback constructive, specific, and actionable. Focus on Formula Student knowledge gaps and provide concrete study suggestions.`

    const result = await model.generateContent(prompt)
    const feedback = result.response.text()
    
    return feedback
  } catch (error) {
    console.error('Error generating feedback with Gemini:', error)
    throw error
  }
}

function generateFallbackFeedback(score: number, totalQuestions: number) {
  const percentage = Math.round((score / totalQuestions) * 100)
  
  if (percentage >= 80) {
    return `Excellent work! You scored ${score}/${totalQuestions} (${percentage}%). You have a strong understanding of Formula Student rules and regulations. Keep up the great work and continue reviewing the latest rulebook updates.`
  } else if (percentage >= 60) {
    return `Good effort! You scored ${score}/${totalQuestions} (${percentage}%). You have a solid foundation but there's room for improvement. Focus on reviewing the areas where you made mistakes and practice with more questions.`
  } else {
    return `You scored ${score}/${totalQuestions} (${percentage}%). Don't worry - Formula Student rules can be complex! I recommend spending more time with the rulebook, focusing on safety requirements, technical regulations, and competition procedures. Practice regularly to improve your knowledge.`
  }
}