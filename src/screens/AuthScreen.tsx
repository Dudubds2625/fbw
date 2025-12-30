// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);

  async function handleAuth() {
    if (!email || !password) return Alert.alert('Erro', 'Preencha email e senha.');
    if (!isLogin && !username) return Alert.alert('Erro', 'Preencha seu nome de aventureiro.');

    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username } // Envia o nome para ser salvo no perfil
          }
        });
        if (error) throw error;
        Alert.alert('Sucesso', 'Cadastro realizado!');
        setIsLogin(true);
      }
    } catch (error: any) {
      Alert.alert('Erro', error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>RPG Companion</Text>
      <Text style={styles.subTitle}>{isLogin ? 'Bem-vindo de volta!' : 'Crie sua identidade'}</Text>

      <View style={styles.inputContainer}>
        {!isLogin && (
          <>
            <Text style={styles.label}>Nome de Usuário</Text>
            <TextInput style={styles.input} placeholder="Ex: Gandalf" placeholderTextColor="#555" value={username} onChangeText={setUsername} />
          </>
        )}
        <Text style={styles.label}>Email</Text>
        <TextInput style={styles.input} placeholder="email@exemplo.com" placeholderTextColor="#555" value={email} onChangeText={setEmail} autoCapitalize="none"/>
        <Text style={styles.label}>Senha</Text>
        <TextInput style={styles.input} placeholder="******" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry/>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isLogin ? 'ENTRAR' : 'CRIAR CONTA'}</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.toggleButton} onPress={() => setIsLogin(!isLogin)}>
        <Text style={styles.toggleText}>{isLogin ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Entre aqui'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#121214' },
  headerTitle: { fontSize: 32, fontWeight: 'bold', color: '#E1E1E6', textAlign: 'center', marginBottom: 10 },
  subTitle: { fontSize: 16, color: '#7C7C8A', textAlign: 'center', marginBottom: 40 },
  inputContainer: { marginBottom: 20 },
  label: { color: '#E1E1E6', marginBottom: 8, fontSize: 14 },
  input: { backgroundColor: '#202024', color: '#E1E1E6', borderRadius: 6, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#323238' },
  button: { backgroundColor: '#8257e5', padding: 16, borderRadius: 6, alignItems: 'center', marginTop: 10 },
  buttonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  toggleButton: { marginTop: 20, alignItems: 'center' },
  toggleText: { color: '#8257e5', fontSize: 14 },
});