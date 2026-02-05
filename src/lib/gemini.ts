import {GoogleGenAI} from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY

if (!API_KEY) {
  throw new Error('Missing Gemini API key. Please set VITE_GEMINI_API_KEY in your environment variables.')
}

const genAI = new GoogleGenerativeAI(API_KEY)

export const geminiModel = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 2048,
  }
})

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = genAI.getGenerativeModel({ model: 'embedding-001' })
    const result = await model.embedContent(text)
    return result.embedding.values
  } catch (error) {
    console.error('Error generating embedding:', error)
    // Fallback: return a simple hash-based embedding
    const hash = simpleHash(text)
    return Array.from({ length: 768 }, (_, i) => Math.sin(hash + i) * 0.1)
  }
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash
}

export async function generateQuizQuestions(context: string, count: number = 5) {
  const prompt = `Based on the following Formula Student context, generate ${count} quiz questions of different types (multiple choice, true/false, open-ended). 

Context: ${context}

Please return a JSON array with questions in this format:
[
  {
    "type": "multiple_choice",
    "question": "Question text here?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "explanation": "Explanation of the correct answer",
    "difficulty": "medium"
  },
  {
    "type": "true_false",
    "question": "Statement to evaluate",
    "correct_answer": true,
    "explanation": "Explanation",
    "difficulty": "easy"
  },
  {
    "type": "open_ended",
    "question": "Open question?",
    "correct_answer": "Sample correct answer",
    "explanation": "What makes a good answer",
    "difficulty": "hard"
  }
]

Make sure questions are relevant to Formula Student rules and regulations.`

  try {
    const result = await geminiModel.generateContent(prompt)
    const response = result.response.text()
    
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    
    throw new Error('No valid JSON found in response')
  } catch (error) {
    console.error('Error generating quiz questions:', error)
    // Return fallback questions
    return [
      {
        type: 'multiple_choice',
        question: 'What is the maximum engine displacement allowed in Formula Student?',
        options: ['610cc', '650cc', '710cc', '750cc'],
        correct_answer: 0,
        explanation: 'The maximum engine displacement is 610cc according to Formula Student rules.',
        difficulty: 'medium'
      }
    ]
  }
}