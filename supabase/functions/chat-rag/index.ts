import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { query, selectedDocuments } = await req.json();
    if (!query || query.trim().length === 0) {
      throw new Error('Query is required');
    }
    
    console.log('📋 Selected documents:', selectedDocuments?.length || 0);
    
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    
    let documents;
    let error;
    
    if (selectedDocuments && selectedDocuments.length > 0) {
      // Use only selected documents
      const { data: selectedDocs, error: selectedError } = await supabaseClient
        .from('documents')
        .select('id, name, content')
        .in('id', selectedDocuments);
      
      documents = selectedDocs;
      error = selectedError;
      console.log('📄 Using selected documents:', documents?.length || 0);
    } else {
      // Find similar documents using vector similarity
      const { data: vectorDocs, error: vectorError } = await supabaseClient.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 5
      });
      
      documents = vectorDocs;
      error = vectorError;
      console.log('🔍 Using vector search:', documents?.length || 0);
    }
    
    if (error) {
      console.error('Vector search error:', error);
      // Fallback to text search
      const { data: fallbackDocs, error: fallbackError } = await supabaseClient.from('documents').select('id, name, content').textSearch('content', query).limit(5);
      if (fallbackError) {
        console.error('Fallback search error:', fallbackError);
        return generateResponse(query, []);
      }
      return generateResponse(query, fallbackDocs || []);
    }
    return generateResponse(query, documents || []);
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(JSON.stringify({
      response: "I'm sorry, I encountered an error while processing your question. Please try again.",
      sources: [],
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  }
});
async function generateEmbedding(text) {
  const words = text.toLowerCase().split(/\s+/);
  const embedding = new Array(768).fill(0);
  for(let i = 0; i < words.length && i < 768; i++){
    const word = words[i];
    let hash = 0;
    for(let j = 0; j < word.length; j++){
      hash = (hash << 5) - hash + word.charCodeAt(j) & 0xffffffff;
    }
    embedding[i % 768] += Math.sin(hash) * 0.1;
  }
  const magnitude = Math.sqrt(embedding.reduce((sum, val)=>sum + val * val, 0));
  return embedding.map((val)=>magnitude > 0 ? val / magnitude : 0);
}
async function generateResponse(query, documents) {
  const sources = documents.map((doc)=>({
      name: doc.name,
      similarity: doc.similarity || 0
    }));
  // Filter out documents with placeholder content
  const validDocs = documents.filter((doc)=>doc.content && !doc.content.startsWith('[PDF Document:'));
  const context = validDocs.map((doc)=>doc.content).join('\n\n');
  let response = '';
  if (validDocs.length === 0) {
    response = "I don't have specific information about that topic in the uploaded documents. " + "This could be because:\n" + "1. The relevant documents haven't been uploaded yet\n" + "2. The documents are still being processed\n" + "3. The question is outside the scope of the available Formula Student materials\n\n" + "Please upload relevant Formula Student rulebooks or documentation, or try rephrasing your question.";
  } else {
    // Extract relevant snippets from context
    const snippets = extractRelevantSnippets(query, context, 3);
    response = "Based on the Formula Student documentation:\n\n";
    if (snippets.length > 0) {
      snippets.forEach((snippet, index)=>{
        response += `${index + 1}. ${snippet}\n\n`;
      });
    } else {
      // Fallback to keyword-based responses
      response += generateKeywordResponse(query, context);
    }
    // Add a note about sources
    if (sources.length > 0) {
      response += `\n\nSources: ${sources.map((s)=>s.name).join(', ')}`;
    }
  }
  return new Response(JSON.stringify({
    response,
    sources: sources.map((s)=>s.name),
    contextLength: context.length,
    documentsFound: validDocs.length
  }), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    },
    status: 200
  });
}
function extractRelevantSnippets(query, context, count = 3) {
  if (!context || context.length === 0) return [];
  const queryWords = query.toLowerCase().split(/\s+/).filter((w)=>w.length > 3);
  const sentences = context.split(/[.!?]+/).filter((s)=>s.trim().length > 20);
  // Score each sentence based on query word matches
  const scoredSentences = sentences.map((sentence)=>{
    const sentenceLower = sentence.toLowerCase();
    const score = queryWords.reduce((acc, word)=>{
      return acc + (sentenceLower.includes(word) ? 1 : 0);
    }, 0);
    return {
      sentence: sentence.trim(),
      score
    };
  });
  // Sort by score and take top N
  return scoredSentences.filter((s)=>s.score > 0).sort((a, b)=>b.score - a.score).slice(0, count).map((s)=>s.sentence);
}
function generateKeywordResponse(query, context) {
  const queryLower = query.toLowerCase();
  // Common Formula Student topics
  const topicKeywords = {
    engine: [
      'engine',
      'motor',
      'powertrain',
      'displacement'
    ],
    brake: [
      'brake',
      'braking',
      'deceleration'
    ],
    safety: [
      'safety',
      'roll cage',
      'harness',
      'fire',
      'extinguisher'
    ],
    chassis: [
      'chassis',
      'frame',
      'structure',
      'monocoque'
    ],
    suspension: [
      'suspension',
      'damper',
      'spring',
      'geometry'
    ],
    aerodynamics: [
      'aero',
      'wing',
      'downforce',
      'drag'
    ],
    electrical: [
      'electrical',
      'wiring',
      'battery',
      'voltage'
    ],
    rules: [
      'rule',
      'regulation',
      'requirement',
      'must'
    ]
  };
  // Find matching topic
  for (const [topic, keywords] of Object.entries(topicKeywords)){
    if (keywords.some((keyword)=>queryLower.includes(keyword))) {
      // Extract relevant context
      const relevantContext = context.substring(0, 800);
      return `Regarding ${topic}, here's relevant information from the documentation:\n\n${relevantContext}...`;
    }
  }
  // Generic response with context
  return `Here's what I found in the documentation:\n\n${context.substring(0, 600)}...`;
}
