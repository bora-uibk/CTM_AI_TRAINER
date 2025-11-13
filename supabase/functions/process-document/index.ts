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
    const { name, file_path, file_size, mime_type } = await req.json();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }
    // For PDFs, we'll store metadata only for now
    // The actual text extraction should be done with a proper PDF library
    const textContent = mime_type === 'application/pdf' ? `[PDF Document: ${name}]` : '';
    // Generate a simple embedding (placeholder for now)
    const embedding = await generateEmbedding(textContent || name);
    // Store document in database
    const { data, error } = await supabaseClient.from('documents').insert({
      name,
      content: textContent,
      file_path,
      file_size,
      mime_type,
      embedding,
      uploaded_by: user.id
    }).select().single();
    if (error) {
      console.error('Database error:', error);
      throw error;
    }
    return new Response(JSON.stringify({
      success: true,
      document: data
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'An error occurred'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
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
