// App.tsx
import 'react-native-url-polyfill/auto';
import { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from './src/lib/supabase';
import { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';

import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import GameScreen from './src/screens/GameScreen';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [activeScreen, setActiveScreen] = useState<'home' | 'game'>('home');
  const [gameRoomCode, setGameRoomCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setGameRoomCode(null);
        setActiveScreen('home');
      }
    });
  }, []);

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#8257e5" /></View>;

  const enterGame = (code: string) => {
    if (!code) return; 
    setGameRoomCode(code);
    setActiveScreen('game');
  };

  const exitGame = () => {
    setGameRoomCode(null);
    setActiveScreen('home');
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#121214' }}>
      {!session ? (
        <AuthScreen />
      ) : activeScreen === 'game' && gameRoomCode ? (
        <GameScreen 
          roomCode={gameRoomCode} 
          userId={session.user.id} 
          onExitGame={exitGame} 
        />
      ) : (
        <HomeScreen 
          onStartGame={enterGame} 
        />
      )}
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121214' }
});