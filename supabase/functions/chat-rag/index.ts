import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.24.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: corsHeaders
  });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { query, selectedDocuments } = await req.json();
    if (!query) throw new Error('Query is required');
    // 1. Initialize Gemini
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const genAI = new GoogleGenerativeAI(apiKey);
    const embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004"
    });
    const chatModel = genAI.getGenerativeModel({
      model: "gemini-flash-latest"
    });
    // 2. Generate Real Embedding for the User's Question
    // This MUST match the model used in process-document (text-embedding-004)
    const result = await embeddingModel.embedContent(query);
    const queryEmbedding = result.embedding.values;
    // 3. Search Database using Real Vector
    // match_document_sections is the SQL function we created earlier
    const { data: chunks, error } = await supabase.rpc('match_document_sections', {
      query_embedding: queryEmbedding,
      match_threshold: 0.4,
      match_count: 25
    });
    if (error) throw error;
    // 4. Filter Results
    let relevantChunks = chunks || [];
    // If user selected specific docs, filter by them
    if (selectedDocuments && selectedDocuments.length > 0) {
      relevantChunks = relevantChunks.filter((chunk)=>selectedDocuments.includes(chunk.document_id));
    }
    // 5. Generate Answer
    let responseText = "";
    let sources = [];
    if (relevantChunks.length > 0) {
      // Build context string for Gemini
      const contextText = relevantChunks.map((chunk)=>chunk.content).join("\n\n---\n\n");
      const prompt = `
        You are an expert technical assistant for Formula Student rules.
        Answer the question strictly based on the context provided below.
        If the answer is not in the context, state that you cannot find it in the provided documents.
        
        USER QUESTION: "${query}"
        
        CONTEXT FROM DOCUMENTS:
        ${contextText}
      `;
      const chatResult = await chatModel.generateContent(prompt);
      responseText = chatResult.response.text();
      // Collect Document IDs as sources
      sources = [
        ...new Set(relevantChunks.map((c)=>c.document_id))
      ];
    } else {
      responseText = "I couldn't find any relevant information in the provided documents matching your query.";
    }
    return new Response(JSON.stringify({
      response: responseText,
      sources: sources
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Chat Error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});
