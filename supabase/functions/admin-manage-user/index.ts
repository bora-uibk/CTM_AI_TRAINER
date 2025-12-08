import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, userId, data } = await req.json();

    // Verify the requesting user is an admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    // Check if user is admin
    const { data: adminCheck, error: adminError } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (adminError || !adminCheck?.is_admin) {
      throw new Error('Insufficient permissions');
    }

    let result;

    switch (action) {
      case 'delete':
        // Delete user from auth (cascades to users table)
        const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
        if (deleteError) throw deleteError;
        result = { success: true, message: 'User deleted successfully' };
        break;

      case 'changePassword':
        // Update user password
        const { error: passwordError } = await supabase.auth.admin.updateUserById(userId, {
          password: data.password
        });
        if (passwordError) throw passwordError;
        result = { success: true, message: 'Password updated successfully' };
        break;

      case 'toggleAdmin':
        // Update admin status
        const { error: adminUpdateError } = await supabase
          .from('users')
          .update({ is_admin: data.isAdmin })
          .eq('id', userId);
        if (adminUpdateError) throw adminUpdateError;
        result = { success: true, message: 'Admin status updated successfully' };
        break;

      default:
        throw new Error('Invalid action');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Admin action error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});