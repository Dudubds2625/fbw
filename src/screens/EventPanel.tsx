import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { GameEvent, EventCharacter, Room, CharacterSkill } from '../types/rpg';

interface EventPanelProps {
  room: Room | null;
}

export default function EventPanel({ room }: EventPanelProps) {
  const [eventData, setEventData] = useState<GameEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [localEnemies, setLocalEnemies] = useState<any[]>([]);
  
  // TRAVA DE SEGURANÇA (Essencial para evitar o "ghosting")
  const isEditingRef = useRef(false);
  const editTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Sincronização (Só atualiza se NÃO estivermos editando/invocando)
  useEffect(() => {
    if (isEditingRef.current) return; // Se a trava estiver ativa, ignora o servidor temporariamente

    if (room?.event_state?.active_enemies) {
        setLocalEnemies(room.event_state.active_enemies);
    } else {
        setLocalEnemies([]);
    }
  }, [room?.event_state]);

  useEffect(() => {
    if (room?.selected_event_id) {
      loadEventData(room.selected_event_id);
    }
  }, [room?.selected_event_id]);

  const loadEventData = async (id: string) => {
    setLoading(true);
    const { data } = await supabase.from('game_events').select('*').eq('id', id).single();
    if (data) setEventData(data);
    setLoading(false);
  };

  const saveToSupabase = async (enemiesList: any[]) => {
    if (!room) return;
    const newState = { ...room.event_state, active_enemies: enemiesList };
    await supabase.from('rooms').update({ event_state: newState }).eq('code', room.code);
  };

  // --- LÓGICA DE PASSIVAS ---
  const applyGlobalPassives = async (char: EventCharacter) => {
      const globalPassives = char.skills?.filter(s => s.type === 'passive' && (s.passive_type === 'general' || s.passive_type === 'general_transformed'));
      if (!globalPassives || globalPassives.length === 0) return;

      const { data: participants } = await supabase.from('room_participants').select('*').eq('room_code', room?.code);
      if (!participants) return;

      let appliedCount = 0;
      for (const p of participants) {
          let updatedDebuffs = [...(p.active_debuffs || [])];
          let changed = false;
          globalPassives.forEach(skill => {
              if (!updatedDebuffs.some(d => d.name === skill.name)) {
                  updatedDebuffs.push({ name: skill.name, description: skill.description, duration: -1, damage: skill.damage });
                  changed = true;
              }
          });
          if (changed) {
              await supabase.from('room_participants').update({ active_debuffs: updatedDebuffs }).eq('id', p.id);
              appliedCount++;
          }
      }
      if (appliedCount > 0) Alert.alert("Efeito Global", `Passivas de ${char.name} aplicadas!`);
  };

  const removeGlobalPassives = async (enemy: any) => {
      const globalPassives = enemy.skills?.filter((s: any) => s.type === 'passive' && (s.passive_type === 'general' || s.passive_type === 'general_transformed'));
      if (!globalPassives || globalPassives.length === 0) return;

      const { data: participants } = await supabase.from('room_participants').select('*').eq('room_code', room?.code);
      if (!participants) return;

      for (const p of participants) {
          if (!p.active_debuffs) continue;
          const originalLength = p.active_debuffs.length;
          const updatedDebuffs = p.active_debuffs.filter((d: any) => !globalPassives.some((s: any) => s.name === d.name));

          if (updatedDebuffs.length !== originalLength) {
              await supabase.from('room_participants').update({ active_debuffs: updatedDebuffs }).eq('id', p.id);
          }
      }
  };

  // --- AÇÕES COM TRAVA (CORREÇÃO DO GHOSTING) ---

  const activateLock = () => {
      isEditingRef.current = true;
      if (editTimeoutRef.current) clearTimeout(editTimeoutRef.current);
      // Mantém a trava por 2.5 segundos para garantir que o servidor atualizou
      editTimeoutRef.current = setTimeout(() => { isEditingRef.current = false; }, 2500);
  };

  const handleSummon = async (template: EventCharacter) => {
    // 1. Ativa a trava IMEDIATAMENTE
    activateLock();

    const newEnemy = {
      ...template,
      instanceId: `${template.name}_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      current_hp: template.base_hp,
      max_hp: template.base_hp,
      skills: template.skills || [] 
    };

    // 2. Atualiza Local
    const updatedList = [...localEnemies, newEnemy];
    setLocalEnemies(updatedList);
    
    // 3. Salva e Aplica Passivas
    saveToSupabase(updatedList);
    await applyGlobalPassives(template);
  };

  const handleRemove = async (enemy: any) => {
    // 1. Ativa a trava
    activateLock();

    const updatedList = localEnemies.filter((e: any) => e.instanceId !== enemy.instanceId);
    setLocalEnemies(updatedList);
    
    saveToSupabase(updatedList);
    await removeGlobalPassives(enemy);
  };

  const handleChangeHp = (instanceId: string, amount: number) => {
      const enemyIndex = localEnemies.findIndex(e => e.instanceId === instanceId);
      if (enemyIndex === -1) return;
      const enemy = localEnemies[enemyIndex];
      const newHp = Math.max(0, Math.min(enemy.max_hp, enemy.current_hp + amount));

      // Se morreu, remove
      if (newHp <= 0) {
          handleRemove(enemy);
          return; 
      }

      // Se está vivo, atualiza com trava
      activateLock();

      const updatedList = [...localEnemies];
      updatedList[enemyIndex] = { ...enemy, current_hp: newHp };
      
      setLocalEnemies(updatedList);
      
      // Debounce do save (espera o usuário parar de clicar)
      // Nota: o activateLock já lida com o timeout da trava visual
      saveToSupabase(updatedList);
  };

  const handleShowSkillInfo = (skill: CharacterSkill) => {
      const typeLabel = (skill.passive_type === 'general' || skill.passive_type === 'general_transformed') ? "🌍 EFEITO GLOBAL" : "🛡️ BUFF INDIVIDUAL";
      Alert.alert(skill.name.toUpperCase(), `${typeLabel}\n\n${skill.description}`);
  };

  // --- RENDER ---
  if (!room) return <View style={styles.center}><ActivityIndicator size="large" color="#8257e5"/></View>;
  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#8257e5"/></View>;
  if (!eventData) return <View style={styles.center}><Text style={styles.text}>Sem evento.</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{eventData.title}</Text>

      <View style={styles.field}>
        <View style={styles.sectionHeader}>
            <Text style={styles.subtitle}>CAMPO DE BATALHA ({localEnemies.length})</Text>
            {localEnemies.length > 0 && <Ionicons name="flame" size={16} color="#ff4444" />}
        </View>
        
        {localEnemies.length === 0 ? (
            <View style={styles.emptyBox}><Text style={styles.emptyText}>Campo vazio.</Text></View>
        ) : (
            <ScrollView style={{maxHeight: 320}}>
                {localEnemies.map((enemy: any) => (
                    <View key={enemy.instanceId} style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.cardName}>{enemy.name}</Text>
                            <TouchableOpacity onPress={() => handleRemove(enemy)} style={styles.removeBtn}>
                                <Ionicons name="close" size={20} color="#ff4444" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.hpInfo}>
                            <View style={styles.hpBarBg}><View style={[styles.hpBarFill, { width: `${Math.min(100, (enemy.current_hp / enemy.max_hp) * 100)}%` }]} /></View>
                            <Text style={styles.hpText}>{enemy.current_hp} / {enemy.max_hp} HP</Text>
                        </View>
                        <View style={styles.controlsRow}>
                            <TouchableOpacity onPress={() => handleChangeHp(enemy.instanceId, -10)} style={[styles.ctrlBtn, {backgroundColor: '#330000'}]}><Text style={[styles.ctrlText, {color: '#ff4444'}]}>-10</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => handleChangeHp(enemy.instanceId, -1)} style={[styles.ctrlBtn, {backgroundColor: '#ff4444'}]}><Ionicons name="remove" size={16} color="#fff" /></TouchableOpacity>
                            <View style={{width: 15}} />
                            <TouchableOpacity onPress={() => handleChangeHp(enemy.instanceId, 1)} style={[styles.ctrlBtn, {backgroundColor: '#00B37E'}]}><Ionicons name="add" size={16} color="#fff" /></TouchableOpacity>
                            <TouchableOpacity onPress={() => handleChangeHp(enemy.instanceId, 10)} style={[styles.ctrlBtn, {backgroundColor: '#003300'}]}><Text style={[styles.ctrlText, {color: '#00B37E'}]}>+10</Text></TouchableOpacity>
                        </View>
                        {enemy.skills && enemy.skills.length > 0 && (
                            <View style={styles.passivesContainer}>
                                {enemy.skills.filter((s: any) => s.type === 'passive').map((skill: any, idx: number) => {
                                    const isGlobal = skill.passive_type === 'general' || skill.passive_type === 'general_transformed';
                                    return (
                                        <TouchableOpacity key={idx} style={[styles.passiveBadge, { borderColor: isGlobal ? '#ff4444' : '#00B37E' }]} onPress={() => handleShowSkillInfo(skill)}>
                                            <Ionicons name={isGlobal ? "skull" : "shield"} size={10} color={isGlobal ? '#ff4444' : '#00B37E'} style={{marginRight: 4}}/>
                                            <Text style={{color: '#ccc', fontSize: 10, fontWeight: 'bold'}}>{skill.name}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}
                    </View>
                ))}
            </ScrollView>
        )}
      </View>

      <View style={styles.summonArea}>
        <Text style={[styles.subtitle, {color:'#00B37E', marginBottom: 10}]}>BESTIÁRIO</Text>
        <ScrollView>
            {eventData.event_characters && eventData.event_characters.length > 0 ? (
                eventData.event_characters.map((char, i) => (
                    <TouchableOpacity key={i} style={styles.summonRow} onPress={() => handleSummon(char)}>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                            <View style={styles.iconBox}><Ionicons name="person" size={14} color="#fff" /></View>
                            <Text style={{color:'#fff', fontWeight:'bold', marginLeft: 10}}>{char.name}</Text>
                        </View>
                        <Text style={{color:'#aaa', fontSize:10}}>{char.base_hp} HP Max</Text>
                    </TouchableOpacity>
                ))
            ) : (
                <Text style={styles.emptyText}>Sem inimigos.</Text>
            )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', padding: 15 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121214' },
  text: { color: '#777', marginTop: 10 },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  subtitle: { color: '#aaa', fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  field: { flex: 1, backgroundColor: '#1c1c1e', padding: 10, borderRadius: 12, marginBottom: 15, borderTopWidth: 2, borderTopColor: '#ff4444' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#555', fontStyle: 'italic' },
  card: { backgroundColor: '#252527', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardName: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  removeBtn: { padding: 4, backgroundColor: '#330000', borderRadius: 4 },
  hpInfo: { marginBottom: 10 },
  hpBarBg: { height: 6, backgroundColor: '#111', borderRadius: 3, marginBottom: 4 },
  hpBarFill: { height: 6, backgroundColor: '#ff4444', borderRadius: 3 },
  hpText: { color: '#ccc', fontSize: 12, textAlign: 'right' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 5 },
  ctrlBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginHorizontal: 4 },
  ctrlText: { fontSize: 10, fontWeight: 'bold' },
  passivesContainer: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#333' },
  passiveBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, marginRight: 6, marginBottom: 4, backgroundColor: 'rgba(0,0,0,0.3)' },
  summonArea: { height: '30%', backgroundColor: '#18181b', padding: 10, borderRadius: 12, borderTopWidth: 2, borderTopColor: '#00B37E' },
  summonRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#2a2a2d' },
  iconBox: { width: 24, height: 24, backgroundColor: '#333', borderRadius: 12, justifyContent: 'center', alignItems: 'center' }
});