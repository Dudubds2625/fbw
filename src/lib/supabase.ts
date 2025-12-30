// src/lib/supabase.ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// SUBSTITUA PELAS SUAS CHAVES DO SUPABASE (Pegue no dashboard do site do Supabase)
const supabaseUrl = 'https://mdjcwikwjhatqkraacio.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kamN3aWt3amhhdHFrcmFhY2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzNjA2NDcsImV4cCI6MjA4MTkzNjY0N30.TGCpTv99iZjm3LfLN4oVvrstfRZZGUf5mFPe8ltZ338';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // Usa o armazenamento do celular
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Importante desativar isso em React Native
  },
});