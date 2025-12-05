import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { GoogleGenerativeAI, TaskType } from 'npm:@google/generative-ai@0.24.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { name, content, file_path, file_size, mime_type, uploaded_by } = await req.json();

    // 1. Save Document Metadata
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        name,
        content, // Full text stored for reference
        file_path,
        file_size,
        mime_type,
        uploaded_by,
      })
      .select()
      .single();

    if (docError) throw docError;

    // 2. Chunk Text
    const chunks = splitTextIntoChunks(content);
    console.log(`Processing ${chunks.length} chunks for ${name} in batches...`);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('GEMINI_API_KEY not set');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

    // 3. Batch Process Embeddings
    const BATCH_SIZE = 20; // Reduced batch size for stability
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + BATCH_SIZE);
      
      // Prepare requests for Gemini
      const requests = batchChunks.map(text => ({
        content: { role: "user", parts: [{ text: text.replace(/\n/g, ' ') }] },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
        title: name
      }));

      console.log(`Embedding batch ${i} - ${i + batchChunks.length}...`);

      const batchResult = await model.batchEmbedContents({ requests });
      const embeddings = batchResult.embeddings;

      // Prepare Data for Insertion
      // IMPORTANT: Ensure embedding is treated as a vector
      const sectionsToInsert = batchChunks.map((chunk, idx) => ({
        document_id: docData.id,
        content: chunk,
        // Postgres vector expects a simple array, Supabase client handles the casting
        // if the table column type is 'vector'.
        embedding: embeddings[idx].values 
      }));

      const { error: sectionError } = await supabase
        .from('document_sections')
        .insert(sectionsToInsert);
        
      if (sectionError) throw sectionError;
    }

    return new Response(JSON.stringify({ success: true, id: docData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});

/**
 * Semantic Splitter
 * Tries to break at sensible boundaries (Paragraphs > Sentences > Words)
 */
function splitTextIntoChunks(text: string): string[] {
  const chunkSize = 1000;
  const overlap = 200;
  const chunks: string[] = [];
  
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    
    // Try to break at a paragraph or sentence end
    if (end < text.length) {
      const nextDoubleNewline = text.lastIndexOf('\n\n', end);
      const nextNewline = text.lastIndexOf('\n', end);
      const nextDot = text.lastIndexOf('. ', end);
      
      if (nextDoubleNewline > i + (chunkSize * 0.5)) end = nextDoubleNewline;
      else if (nextNewline > i + (chunkSize * 0.6)) end = nextNewline;
      else if (nextDot > i + (chunkSize * 0.7)) end = nextDot + 1;
    }

    const chunk = text.slice(i, end).trim();
    if (chunk.length > 50) { 
      chunks.push(chunk);
    }
    
    i = end - overlap;
    if (i < 0) i = 0;
    if (end === text.length) break;
  }
  
  return chunks;
}