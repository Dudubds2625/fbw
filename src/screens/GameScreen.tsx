// src/screens/GameScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, 
  Alert, Image, ActivityIndicator, Modal, FlatList, ImageBackground 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Room, RoomParticipant, GameCharacter, GameEvent, CharacterSkill, ActiveTransformation, StatusEffect, ActiveStatusEffect, TeamMember, TeamMemberState, MatchHistoryItem } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';

interface GameScreenProps {
  roomCode: string;
  userId: string;
  onExitGame: () => void;
}

export default function GameScreen({ roomCode, userId, onExitGame }: GameScreenProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [myParticipant, setMyParticipant] = useState<RoomParticipant | null>(null);
  const [charactersMap, setCharactersMap] = useState<Record<string, GameCharacter>>({});
  
  const [mySkills, setMySkills] = useState<CharacterSkill[]>([]);
  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  
  // MODAIS
  const [skillsModalVisible, setSkillsModalVisible] = useState(false);
  const [effectsListModalVisible, setEffectsListModalVisible] = useState(false);
  const [targetEffectType, setTargetEffectType] = useState<'buff' | 'debuff'>('buff');
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [deployMemberModalVisible, setDeployMemberModalVisible] = useState(false); 

  // NOTIFICAÇÃO
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [notificationData, setNotificationData] = useState({
      title: '', message: '', type: 'info', onConfirm: () => {}, hasCancel: false, onCancel: () => {}, confirmText: 'CONFIRMAR', cancelText: 'CANCELAR'
  });

  const [gameEvent, setGameEvent] = useState<GameEvent | null>(null);
  
  // REFS
  const currentEventIdRef = useRef<string | null>(null);
  const hasShownEventRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prevTurnIdRef = useRef<string | null>(null);
  const skillsLoadedRef = useRef(false);

  // STATUS LOCAIS
  const [hp, setHp] = useState(10);
  const [maxHp, setMaxHp] = useState(10);
  const [shield, setShield] = useState(0);
  const [maxShield, setMaxShield] = useState(0);
  const [buffs, setBuffs] = useState('');
  const [debuffs, setDebuffs] = useState('');
  
  const [processingPhase, setProcessingPhase] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [victoryHandled, setVictoryHandled] = useState(false);

  useEffect(() => {
    fetchGameData();
    subscribeToGame();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  const showCustomAlert = (title: string, message: string, type: 'info'|'damage'|'victory' = 'info', onConfirm?: () => void, hasCancel = false, onCancel?: () => void, confirmText = 'CONFIRMAR', cancelText = 'CANCELAR') => {
      setNotificationData({ title, message, type, onConfirm: () => { setNotificationVisible(false); if (onConfirm) onConfirm(); }, hasCancel, onCancel: () => { setNotificationVisible(false); if (onCancel) onCancel(); }, confirmText, cancelText });
      setNotificationVisible(true);
  };

  useEffect(() => {
    if (myParticipant && Object.keys(charactersMap).length > 0 && !initialCheckDone) {
        const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
        if (myChar?.category === 'equipe') {
            const activeUnits = myParticipant.team_state || [];
            if (activeUnits.length === 0) setDeployMemberModalVisible(true);
        }
        setInitialCheckDone(true); 
    }
  }, [myParticipant, charactersMap, initialCheckDone]);

  // DETECTAR VITÓRIA
  useEffect(() => {
      if (!participants || participants.length === 0 || !myParticipant) return;
      const survivors = participants.filter(p => p.current_hp > 0);
      if (survivors.length === 1 && survivors[0].id === myParticipant.id && !victoryHandled && participants.length > 1) {
          setVictoryHandled(true); 
          showCustomAlert("👑 VITÓRIA SUPREMA!", "Todos os oponentes caíram. Registrar vitória?", 'victory', handleConfirmVictory, true, () => {}, "REGISTRAR", "AINDA NÃO");
      }
  }, [participants, myParticipant, victoryHandled]);

  const handleConfirmVictory = async () => {
      if (!myParticipant || !room) return;
      const myCharId = myParticipant.selected_character_id;
      const myChar = myCharId ? charactersMap[myCharId] : null;
      try {
          const createdTime = new Date(room.created_at).getTime();
          const endTime = new Date().getTime();
          const durationSeconds = Math.floor((endTime - createdTime) / 1000);
          await supabase.from('victories').insert({ 
              user_id: userId,
              character_name: myChar?.name || myParticipant.username, 
              session_name: roomCode, 
              victory_date: new Date().toISOString()
          });
          await supabase.from('match_history').insert({
              room_code: roomCode,
              winner_name: myParticipant.username,
              winner_character: myChar?.name || 'Desconhecido',
              duration_seconds: durationSeconds,
              participants_snapshot: participants 
          });
          if (myCharId) {
              const { error: levelError } = await supabase.rpc('increment_char_level', { uid: userId, char_id: myCharId });
              if (levelError) {
                  const { data: roster } = await supabase.from('user_roster').select('current_level').eq('user_id', userId).eq('character_id', myCharId).single();
                  if (roster) {
                      await supabase.from('user_roster').update({ current_level: roster.current_level + 1 }).eq('user_id', userId).eq('character_id', myCharId);
                  }
              }
          }
          showCustomAlert("🏆 Lenda!", "Vitória registrada! Nível Subiu!", 'victory', handleLeaveRoom);
      } catch (error: any) { showCustomAlert("Erro", error.message); }
  };

  const fetchGameData = async () => {
    try {
        const { data: roomData, error: roomError } = await supabase.from('rooms').select('*').eq('code', roomCode).maybeSingle(); 
        if (roomError) throw roomError;
        if (!roomData) { Alert.alert("Erro", "Sala não encontrada."); onExitGame(); return; }
        setRoom(roomData);
        if (roomData.current_turn_participant_id) checkTurnChange(roomData.current_turn_participant_id);
        if (roomData.selected_event_id && roomData.selected_event_id !== currentEventIdRef.current) {
            const { data: ev } = await supabase.from('game_events').select('*').eq('id', roomData.selected_event_id).maybeSingle();
            if (ev) { setGameEvent(ev); currentEventIdRef.current = ev.id; hasShownEventRef.current = false; }
            if (!hasShownEventRef.current) { setEventModalVisible(true); hasShownEventRef.current = true; }
        }
        if (catalogEffects.length === 0) {
            const { data: effs } = await supabase.from('game_status_effects').select('*').order('title');
            if (effs) setCatalogEffects(effs);
        }
        const { data: parts } = await supabase.from('room_participants').select('*').eq('room_code', roomCode).order('turn_order', { ascending: true });
        if (parts) {
            setParticipants(parts);
            const me = parts.find(p => p.user_id === userId);
            if (me) {
                setMyParticipant(me);
                if (me.max_hp !== maxHp) setMaxHp(me.max_hp);
                if (me.current_hp !== hp && !processingPhase) setHp(me.current_hp);
                if (me.current_shield !== undefined && me.current_shield !== shield) setShield(me.current_shield);
                if (me.buffs !== buffs) setBuffs(me.buffs || '');
                if (me.debuffs !== debuffs) setDebuffs(me.debuffs || '');
                if (me.selected_character_id && !skillsLoadedRef.current) {
                    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', me.selected_character_id);
                    if (skills) { setMySkills(skills); skillsLoadedRef.current = true; }
                }
            }
            const charIds2 = parts.map(p => p.selected_character_id).filter(id => id) as string[];
            if (charIds2.length > 0) {
                const { data: chars } = await supabase.from('game_characters').select('*').in('id', charIds2);
                const map: Record<string, GameCharacter> = {};
                chars?.forEach(c => map[c.id] = c);
                setCharactersMap(map);
                if (me && me.selected_character_id && map[me.selected_character_id]) {
                    const charBaseShield = map[me.selected_character_id].base_shield || 0;
                    if (charBaseShield !== maxShield) setMaxShield(charBaseShield);
                }
            }
        }
    } catch (error: any) { console.log("Erro fetchGameData:", error); }
  };

  const subscribeToGame = () => {
    const channel = supabase.channel(`game_${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, payload => {
            const newRoom = payload.new as Room;
            setRoom(newRoom);
            if (newRoom.current_turn_participant_id) checkTurnChange(newRoom.current_turn_participant_id);
            if (newRoom.selected_event_id && newRoom.selected_event_id !== currentEventIdRef.current) fetchGameData(); 
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchGameData())
      .subscribe();
    channelRef.current = channel;
  };

  const handlePhaseAction = async () => {
    if (!room || !participants.length || !room.current_turn_participant_id) return;
    if (myParticipant && room.current_turn_participant_id !== myParticipant.id) return;
    setProcessingPhase(true);
    try {
        const currentPhase = room.turn_phase || 'initial';
        if (currentPhase === 'initial') {
            await supabase.from('rooms').update({ turn_phase: 'main' }).eq('code', roomCode);
        } else if (currentPhase === 'main') {
            await processEndTurnLogic(); 
            await supabase.from('rooms').update({ turn_phase: 'end' }).eq('code', roomCode);
        } else {
            const currentIndex = participants.findIndex(p => p.id === room.current_turn_participant_id);
            const nextIndex = (currentIndex + 1) % participants.length;
            await supabase.from('rooms').update({ current_turn_participant_id: participants[nextIndex].id, turn_phase: 'initial' }).eq('code', roomCode);
        }
    } catch (error) { showCustomAlert("Erro", "Falha ao mudar de fase."); } finally { setProcessingPhase(false); }
  };

  const processEndTurnLogic = async () => {
      if (!myParticipant) return;
      let updatedTrans = [...(myParticipant.active_transformations || [])];
      let transExpired: string[] = [];
      updatedTrans = updatedTrans.map(t => ({ ...t, rounds_left: t.rounds_left - 1 })).filter(t => { if (t.rounds_left <= 0) { transExpired.push(t.name); return false; } return true; });
      let updatedBuffs = [...(myParticipant.active_buffs || [])];
      let buffsExpired: string[] = [];
      updatedBuffs = updatedBuffs.map(b => ({ ...b, duration: b.duration - 1 })).filter(b => { if (b.duration <= 0) { buffsExpired.push(b.name); return false; } return true; });
      let updatedDebuffs = [...(myParticipant.active_debuffs || [])];
      let debuffsExpired: string[] = [];
      let totalDamageTaken = 0;
      let damageSources: string[] = [];
      updatedDebuffs = updatedDebuffs.map(d => {
          if (d.damage) {
              const dmgVal = parseInt(d.damage);
              if (!isNaN(dmgVal) && dmgVal > 0) {
                  let finalDmg = dmgVal;
                  const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
                  if (myChar?.category === 'hit') finalDmg = 1; 
                  totalDamageTaken += finalDmg;
                  damageSources.push(`${d.name} (${finalDmg})`);
              }
          }
          return { ...d, duration: d.duration - 1 };
      }).filter(d => { if (d.duration <= 0) { debuffsExpired.push(d.name); return false; } return true; });

      let currentShield = shield;
      let currentHp = hp;
      
      if (totalDamageTaken > 0) {
          if (currentShield >= totalDamageTaken) {
              currentShield -= totalDamageTaken;
          } else {
              const remainingDmg = totalDamageTaken - currentShield;
              currentShield = 0;
              currentHp = Math.max(0, currentHp - remainingDmg);
          }
      }

      setShield(currentShield);
      setHp(currentHp);

      await supabase.from('room_participants').update({ active_transformations: updatedTrans, active_buffs: updatedBuffs, active_debuffs: updatedDebuffs, current_hp: currentHp, current_shield: currentShield }).eq('id', myParticipant.id);

      let msgParts = [];
      if (totalDamageTaken > 0) msgParts.push(`💥 Sofreu ${totalDamageTaken} de dano (${damageSources.join(', ')}).`);
      if (transExpired.length > 0) msgParts.push(`❌ Transformações encerradas: ${transExpired.join(', ')}.`);
      if (buffsExpired.length > 0) msgParts.push(`📉 Buffs expirados: ${buffsExpired.join(', ')}.`);
      if (debuffsExpired.length > 0) msgParts.push(`✨ Debuffs removidos: ${debuffsExpired.join(', ')}.`);
      if (msgParts.length > 0) { showCustomAlert("RESUMO DA FASE", msgParts.join('\n\n'), 'damage'); }
  };

  const checkTurnChange = async (currentTurnParticipantId: string) => {
      const myId = participants.find(p => p.user_id === userId)?.id;
      if (myId && prevTurnIdRef.current && prevTurnIdRef.current !== myId && currentTurnParticipantId === myId) { console.log("⚡ É MEU TURNO!"); }
      prevTurnIdRef.current = currentTurnParticipantId;
  };

  const updateGlobalStats = async (newHp: number, newMax: number) => { if (!myParticipant) return; await supabase.from('room_participants').update({ current_hp: newHp, max_hp: newMax }).eq('id', myParticipant.id); };
  const changeHp = (amount: number) => { let finalAmount = amount; const myChar = myParticipant?.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null; if (myChar?.category === 'hit' && amount < 0) finalAmount = -1; const newVal = Math.max(0, Math.min(maxHp, hp + finalAmount)); setHp(newVal); updateGlobalStats(newVal, maxHp); };
  const changeMaxHp = (amount: number) => { const newVal = Math.max(1, maxHp + amount); setMaxHp(newVal); const fixedHp = Math.min(hp, newVal); if (fixedHp !== hp) setHp(fixedHp); updateGlobalStats(fixedHp, newVal); };
  const changeShield = async (amount: number) => { if (!myParticipant) return; const newVal = Math.max(0, shield + amount); setShield(newVal); await supabase.from('room_participants').update({ current_shield: newVal }).eq('id', myParticipant.id); };

  const handleAddMemberToField = async (member: TeamMember) => {
      if (!myParticipant) return;
      const currentState = [...(myParticipant.team_state || [])];
      const newUnit: TeamMemberState = { name: member.name, current_hp: member.base_hp, max_hp: member.base_hp };
      const newState = [...currentState, newUnit];
      const totalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
      const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0);
      await supabase.from('room_participants').update({ team_state: newState, current_hp: totalHp, max_hp: totalMaxHp }).eq('id', myParticipant.id);
      setDeployMemberModalVisible(false);
  };

  const changeUnitHp = async (index: number, amount: number) => {
      if (!myParticipant || !myParticipant.team_state) return;
      const newState = [...myParticipant.team_state];
      const unit = { ...newState[index] }; 
      unit.current_hp = Math.min(unit.max_hp, unit.current_hp + amount);
      if (unit.current_hp <= 0) { newState.splice(index, 1); } else { newState[index] = unit; }
      const totalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
      const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0); 
      await supabase.from('room_participants').update({ team_state: newState, current_hp: totalHp, max_hp: totalMaxHp }).eq('id', myParticipant.id);
  };

  const handleLeaveRoom = async () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    await supabase.from('room_participants').delete().eq('room_code', roomCode).eq('user_id', userId);
    onExitGame();
  };

  const handleRemovePassive = (skillId: string) => { setMySkills(prev => prev.filter(s => s.id !== skillId)); };
  const handlePressPassive = (skill: CharacterSkill) => { showCustomAlert(skill.name, skill.description, 'info', () => handleRemovePassive(skill.id), true, undefined, "REMOVER", "FECHAR"); };
  const removeStatusEffect = async (effectName: string, type: 'buff' | 'debuff') => { if (!myParticipant) return; if (type === 'buff') { const newArr = (myParticipant.active_buffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_buffs: newArr }).eq('id', myParticipant.id); } else { const newArr = (myParticipant.active_debuffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_debuffs: newArr }).eq('id', myParticipant.id); } };
  const handlePressStatusEffect = (effect: ActiveStatusEffect, type: 'buff' | 'debuff') => { let detailText = effect.description ? effect.description : "Sem descrição."; detailText += `\n\nDuração: ${getVisualDuration(effect.duration, type)}`; if(effect.damage) detailText += `\nDano: ${effect.damage}`; showCustomAlert(effect.name, detailText, type === 'buff' ? 'info' : 'damage', () => removeStatusEffect(effect.name, type), true, undefined, "REMOVER", "FECHAR"); };
  const activateSkill = async (skill: CharacterSkill) => { if (skill.type === 'transformation') { const currentList = myParticipant?.active_transformations || []; if (currentList.some(t => t.name === skill.name)) { showCustomAlert("Ops", `${skill.name} já está ativa.`); return; } const baseDuration = (skill.duration && skill.duration > 0) ? skill.duration : 3; const durationWithBuffer = baseDuration + 1; const newList = [...currentList, { name: skill.name, rounds_left: durationWithBuffer }]; await supabase.from('room_participants').update({ active_transformations: newList }).eq('id', myParticipant?.id); showCustomAlert("Transformação!", `${skill.name} ativada por ${baseDuration} rodadas.`, 'info'); } else { const newBuffs = buffs ? `${buffs}, ${skill.name}` : skill.name; setBuffs(newBuffs); await supabase.from('room_participants').update({ buffs: newBuffs }).eq('id', myParticipant?.id); showCustomAlert("Habilidade", `${skill.name} usada!`, 'info'); } setSkillsModalVisible(false); };
  const openEffectList = (type: 'buff' | 'debuff') => { setTargetEffectType(type); setEffectsListModalVisible(true); };
  const applyStatusEffect = async (effect: StatusEffect) => { if (!myParticipant) return; const baseDuration = (effect.duration && effect.duration > 0) ? effect.duration : 0; const finalDuration = targetEffectType === 'buff' ? (baseDuration > 0 ? baseDuration + 1 : 0) : baseDuration; const newEffect: ActiveStatusEffect = { name: effect.title, description: effect.description, damage: effect.damage, duration: finalDuration }; if (targetEffectType === 'buff') { const currentBuffs = myParticipant.active_buffs || []; if (currentBuffs.some(b => b.name === newEffect.name)) { showCustomAlert("Repetido", "Já possui esse buff."); return; } await supabase.from('room_participants').update({ active_buffs: [...currentBuffs, newEffect] }).eq('id', myParticipant.id); } else { const currentDebuffs = myParticipant.active_debuffs || []; if (currentDebuffs.some(d => d.name === newEffect.name)) { showCustomAlert("Repetido", "Já possui esse debuff."); return; } await supabase.from('room_participants').update({ active_debuffs: [...currentDebuffs, newEffect] }).eq('id', myParticipant.id); } setEffectsListModalVisible(false); };
  const getVisualDuration = (dur: number, type: 'buff' | 'debuff' | 'trans') => { if (dur <= 0) return '∞'; if (type === 'debuff') return `${dur}`; return `${Math.max(dur - 1, 0)}`; };
  const getPhaseLabel = (phase?: string) => { switch(phase) { case 'main': return "MAIN"; case 'end': return "END"; default: return "INIT"; } };
  const getButtonLabel = (phase?: string) => { switch(phase) { case 'initial': return "MAIN 🛡️"; case 'main': return "END 🏁"; case 'end': return "TURN ⏭️"; default: return "INICIAR"; } };
  const getPhaseColor = (phase?: string) => { switch(phase) { case 'main': return "#00B37E"; case 'end': return "#FFD700"; default: return "#8257e5"; } };

  if (!myParticipant || !room) return <View style={styles.loading}><ActivityIndicator size="large" color="#8257e5" /><Text style={{color:'#fff'}}>Carregando...</Text><TouchableOpacity onPress={onExitGame} style={{marginTop:20, padding:10, backgroundColor:'#333', borderRadius:8}}><Text style={{color:'#fff'}}>Sair</Text></TouchableOpacity></View>;

  const isMyTurn = room.current_turn_participant_id === myParticipant.id;
  const currentPhase = room.turn_phase || 'initial';
  const myChar = myParticipant.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
  const currentPlayer = participants.find(p => p.id === room.current_turn_participant_id);
  
  const transformations = mySkills.filter(s => s.type === 'transformation');
  const activeSkills = mySkills.filter(s => s.type === 'active');
  const passives = mySkills.filter(s => s.type === 'passive');
  const filteredEffects = catalogEffects.filter(e => e.type === targetEffectType);
  const reserveMembers = myChar?.team_members || [];
  const activeUnits = myParticipant.team_state || [];

  const getNotifyColor = () => { switch(notificationData.type) { case 'victory': return '#FFD700'; case 'damage': return '#ff4444'; default: return '#8257e5'; } };
  const showBanner = (myParticipant.challenge_completed === true) && myChar?.challenge_banner_url;

  return (
    <View style={styles.container}>
      <View style={[styles.turnHeader, isMyTurn ? styles.myTurnHeader : {}]}>
        <View style={{flex: 1}}>
            <Text style={styles.turnText}>{isMyTurn ? "🔥 SUA VEZ!" : `Vez de: ${currentPlayer?.username || '...'}`}</Text>
            <View style={{flexDirection:'row', alignItems:'center', marginTop: 2}}>
                <View style={[styles.phaseDot, currentPhase === 'initial' && {backgroundColor: '#8257e5'}]} />
                <View style={[styles.phaseLine, (currentPhase === 'main' || currentPhase === 'end') && {backgroundColor: '#00B37E'}]} />
                <View style={[styles.phaseDot, currentPhase === 'main' && {backgroundColor: '#00B37E'}]} />
                <View style={[styles.phaseLine, currentPhase === 'end' && {backgroundColor: '#FFD700'}]} />
                <View style={[styles.phaseDot, currentPhase === 'end' && {backgroundColor: '#FFD700'}]} />
                <Text style={[styles.phaseText, {color: getPhaseColor(currentPhase)}]}>{getPhaseLabel(currentPhase)}</Text>
            </View>
        </View>
        <TouchableOpacity style={styles.missionBtn} onPress={() => setEventModalVisible(true)}><Ionicons name="map" color="#fff" size={14} /><Text style={styles.missionBtnText}> Missão</Text></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* BANNER PRINCIPAL (MANTIDO AS BOXES TRANSLÚCIDAS) */}
        <View style={[styles.charArea, !showBanner && {backgroundColor: '#2A2A2E'}]}>
            {showBanner && (
                <Image source={{ uri: myChar.challenge_banner_url }} style={styles.bannerBackground} resizeMode="cover" />
            )}
            
            <View style={styles.charImageContainer}>
                {myChar?.image_url ? (
                    <Image source={{ uri: myChar.image_url }} style={styles.charImage} />
                ) : (
                    <View style={styles.charPlaceholder}><Ionicons name="person" size={40} color="#fff" /></View>
                )}
            </View>

            <View style={{flex:1}}>
                <View style={[styles.textBox, { marginBottom: 5 }]}>
                    <Text style={styles.charName}>{myChar?.name || 'Unknown'}</Text>
                </View>
                {myParticipant.challenge_completed === true && (
                     <View style={[styles.textBox, {backgroundColor: 'rgba(255, 215, 0, 0.2)', borderWidth:1, borderColor:'#FFD700', marginBottom:2}]}>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                            <Ionicons name="trophy" size={10} color="#FFD700" style={{marginRight:4}}/>
                            <Text style={{color:'#FFD700', fontSize:10, fontWeight:'bold'}}>DESAFIO COMPLETO</Text>
                        </View>
                     </View>
                )}
                <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                    <View style={styles.textBox}>
                        <Text style={styles.playerNameTag}>({myParticipant.username})</Text>
                    </View>
                    {myChar?.category && (
                        <View style={[styles.textBox, {marginLeft:5}]}>
                            <Text style={[styles.playerNameTag, {color:'#FFD700', fontWeight:'bold'}]}>{myChar.category.toUpperCase()}</Text>
                        </View>
                    )}
                </View>
            </View>
        </View>

        {myChar?.category === 'equipe' ? (
            <View style={styles.teamContainer}>
                <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                    <Text style={styles.label}>UNIDADES ATIVAS</Text>
                    <TouchableOpacity onPress={() => setDeployMemberModalVisible(true)} style={styles.addMemberBtn}>
                        <Ionicons name="add" size={16} color="#000" />
                        <Text style={styles.addMemberText}> Invocar</Text>
                    </TouchableOpacity>
                </View>
                {activeUnits.length === 0 ? (
                    <Text style={{color:'#555', fontStyle:'italic', textAlign:'center', marginVertical:10}}>Nenhuma unidade em campo.</Text>
                ) : (
                    activeUnits.map((unit, idx) => (
                        <View key={`${unit.name}-${idx}`} style={styles.unitRow}>
                            <Text style={styles.unitName}>{unit.name}</Text>
                            <View style={styles.unitControls}>
                                <TouchableOpacity onPress={() => changeUnitHp(idx, -1)} style={[styles.miniBtn, {backgroundColor:'#ff4444'}]}><Ionicons name="remove" size={16} color="#fff"/></TouchableOpacity>
                                <Text style={styles.unitHp}>{unit.current_hp}</Text>
                                <TouchableOpacity onPress={() => changeUnitHp(idx, 1)} style={[styles.miniBtn, {backgroundColor:'#00B37E'}]}><Ionicons name="add" size={16} color="#fff"/></TouchableOpacity>
                            </View>
                        </View>
                    ))
                )}
                <Text style={{color:'#777', fontSize:10, textAlign:'center', marginTop:5}}>HP TOTAL DO EXÉRCITO: {hp}</Text>
            </View>
        ) : (
            <>
                {maxShield > 0 && (
                    <View style={[styles.statsCard, {borderColor: '#29B6F6', borderWidth: 1}]}>
                        <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                            <Text style={[styles.label, {color:'#29B6F6'}]}>ESCUDO</Text>
                            <Text style={{color:'#29B6F6', fontWeight:'bold'}}>Max: {maxShield}</Text>
                        </View>
                        <View style={styles.hpControls}>
                            <TouchableOpacity onPress={() => changeShield(-10)} style={styles.smallCtrlBtn}><Text style={styles.smallCtrlText}>-10</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => changeShield(-1)} style={[styles.hpBtn, {backgroundColor: '#333', borderWidth:1, borderColor:'#29B6F6'}]}><Ionicons name="remove" size={32} color="#29B6F6" /></TouchableOpacity>
                            <View style={styles.hpDisplay}><Text style={[styles.hpValue, {color:'#29B6F6'}]}>{shield}</Text></View>
                            <TouchableOpacity onPress={() => changeShield(1)} style={[styles.hpBtn, {backgroundColor: '#333', borderWidth:1, borderColor:'#29B6F6'}]}><Ionicons name="add" size={32} color="#29B6F6" /></TouchableOpacity>
                            <TouchableOpacity onPress={() => changeShield(10)} style={styles.smallCtrlBtn}><Text style={styles.smallCtrlText}>+10</Text></TouchableOpacity>
                        </View>
                    </View>
                )}

                <View style={styles.statsCard}>
                    <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                        <Text style={styles.label}>{myChar?.category === 'hit' ? "HITS (VIDA FIXA)" : "HP"}</Text>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                            <Text style={[styles.label, {color:'#777', marginRight:5}]}>Max:</Text>
                            <TouchableOpacity onPress={() => changeMaxHp(-1)}><Ionicons name="remove-circle" color="#555" size={24}/></TouchableOpacity>
                            <Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:5, fontSize:16}}>{maxHp}</Text>
                            <TouchableOpacity onPress={() => changeMaxHp(1)}><Ionicons name="add-circle" color="#555" size={24}/></TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.hpControls}>
                        <TouchableOpacity onPress={() => changeHp(-10)} style={[styles.smallCtrlBtn, {backgroundColor:'#330000'}]}><Text style={[styles.smallCtrlText, {color:'#ff4444'}]}>-10</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => changeHp(-1)} style={[styles.hpBtn, {backgroundColor: '#ff4444'}]}><Ionicons name="remove" size={32} color="#fff" /></TouchableOpacity>
                        <View style={styles.hpDisplay}><Text style={styles.hpValue}>{hp}</Text></View>
                        <TouchableOpacity onPress={() => changeHp(1)} style={[styles.hpBtn, {backgroundColor: '#00B37E'}]}><Ionicons name="add" size={32} color="#fff" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => changeHp(10)} style={[styles.smallCtrlBtn, {backgroundColor:'#003300'}]}><Text style={[styles.smallCtrlText, {color:'#00B37E'}]}>+10</Text></TouchableOpacity>
                    </View>
                </View>
            </>
        )}

        {/* BUFFS E SKILLS (MANTIDOS) */}
        <View style={[styles.statsCard, {marginBottom:10}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                <Text style={[styles.label, {color:'#00B37E', marginBottom:0}]}>BUFFS</Text>
                <TouchableOpacity onPress={() => openEffectList('buff')}><Ionicons name="add-circle" size={24} color="#00B37E" /></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                {(!myParticipant.active_buffs?.length && !buffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum buff.</Text> : null}
                {myParticipant.active_buffs?.map((b, idx) => (
                    <TouchableOpacity key={`ab-${idx}`} style={[styles.activeTransBadge, {borderColor:'#00B37E', backgroundColor:'rgba(0, 179, 126, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => handlePressStatusEffect(b, 'buff')}>
                        <Text style={[styles.activeTransText, {color:'#00B37E', marginRight:5}]}>{b.name} ({getVisualDuration(b.duration, 'buff')})</Text>
                        <Ionicons name="information-circle-outline" size={14} color="#00B37E" />
                    </TouchableOpacity>
                ))}
            </View>
        </View>

        <View style={[styles.statsCard, {marginBottom:10}]}>
            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                <Text style={[styles.label, {color:'#ff4444', marginBottom:0}]}>DEBUFFS</Text>
                <TouchableOpacity onPress={() => openEffectList('debuff')}><Ionicons name="add-circle" size={24} color="#ff4444" /></TouchableOpacity>
            </View>
            <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                {(!myParticipant.active_debuffs?.length && !debuffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum debuff.</Text> : null}
                {myParticipant.active_debuffs?.map((d, idx) => (
                    <TouchableOpacity key={`ad-${idx}`} style={[styles.activeTransBadge, {borderColor:'#ff4444', backgroundColor:'rgba(255, 68, 68, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => handlePressStatusEffect(d, 'debuff')}>
                        <Text style={[styles.activeTransText, {color:'#ff4444', marginRight:5}]}>{d.name} {d.damage ? `[${d.damage}]` : ''} ({getVisualDuration(d.duration, 'debuff')})</Text>
                        <Ionicons name="information-circle-outline" size={14} color="#ff4444" />
                    </TouchableOpacity>
                ))}
            </View>
        </View>

        {myParticipant.active_transformations && myParticipant.active_transformations.length > 0 && (
            <View style={[styles.statsCard, {marginBottom:10}]}>
                <Text style={[styles.label, {color:'#FFD700', marginBottom:5}]}>TRANSFORMAÇÕES:</Text>
                <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                    {myParticipant.active_transformations.map((t, idx) => (
                        <View key={`t-${idx}`} style={styles.activeTransBadge}><Text style={styles.activeTransText}>{t.name} ({getVisualDuration(t.rounds_left, 'trans')} rnds)</Text></View>
                    ))}
                </View>
            </View>
        )}

        {passives.length > 0 && (
            <View style={[styles.statsCard, {marginBottom:10}]}>
                <Text style={[styles.label, {color:'#aaa', marginBottom:5}]}>PASSIVAS ATIVAS</Text>
                <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                    {passives.map((s, idx) => (
                        <TouchableOpacity key={`pas-${idx}`} style={styles.activeTransBadge} onPress={() => handlePressPassive(s as any)}>
                            <Text style={[styles.activeTransText, {color:'#ccc'}]}>{s.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        )}

        <TouchableOpacity style={styles.skillsButton} onPress={() => setSkillsModalVisible(true)}><Ionicons name="flash" size={20} color="#FFD700" style={{marginRight:10}} /><Text style={styles.skillsButtonText}>HABILIDADES & TRANSFORMAÇÕES</Text></TouchableOpacity>

        <Text style={styles.sectionTitle}>Grupo</Text>
        {participants.map(p => {
           const pChar = p.selected_character_id ? charactersMap[p.selected_character_id] : null;
           const isCurrent = room.current_turn_participant_id === p.id;
           const showRowBanner = (p.challenge_completed === true) && pChar?.challenge_banner_url;

           if (showRowBanner) {
               // RENDERIZAÇÃO QUANDO TEM BANNER (USANDO ImageBackground)
               return (
                   <ImageBackground 
                       key={p.id}
                       source={{ uri: pChar?.challenge_banner_url }} 
                       style={[styles.participantRow, isCurrent ? styles.activeRowBorder : {}]}
                       imageStyle={{ opacity: 1, borderRadius: 12 }} // Imagem plena
                       resizeMode="cover"
                   >
                       {/* CAMADA PRETA SEMI-TRANSPARENTE PARA GARANTIR LEITURA */}
                       <View style={styles.darkOverlay} />

                       {/* CONTEÚDO (TEXTOS) */}
                       <View style={{flex: 1}}>
                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                {isCurrent && <Ionicons name="caret-forward" color="#FFD700" size={16} style={{marginRight: 5}} />}
                                <Text style={[styles.pName, {color: isCurrent ? '#FFD700' : '#FFF'}]}>{p.username}</Text>
                            </View>
                            <Text style={[styles.pSubName, {color:'#DDD'}]}>
                                {pChar?.name} 
                                {pChar?.category === 'equipe' && ` (${p.team_state?.length || 0} unidades)`}
                            </Text>
                            {(p.current_shield || 0) > 0 && (<Text style={{color:'#29B6F6', fontSize:10, fontWeight:'bold', marginTop:2}}>🛡️ {p.current_shield}</Text>)}
                            <View style={{flexDirection:'row', flexWrap:'wrap', marginTop:2}}>
                               {p.active_transformations?.map((t, idx) => (<Text key={`t-${idx}`} style={{color:'#FFD700', fontSize:10, marginRight:5}}>★ {t.name}</Text>))}
                               {p.active_buffs?.map((b, idx) => (<Text key={`b-${idx}`} style={{color:'#00B37E', fontSize:10, marginRight:5}}>↑ {b.name}</Text>))}
                               {p.active_debuffs?.map((d, idx) => (<Text key={`d-${idx}`} style={{color:'#ff4444', fontSize:10, marginRight:5}}>↓ {d.name}</Text>))}
                           </View>
                       </View>

                       <View style={{alignItems:'center'}}>
                           {(p.active_debuffs && p.active_debuffs.length > 0) && <Ionicons name="skull" color="#ff4444" size={12} style={{marginBottom: 2}} />}
                           <Text style={[styles.pHp, p.current_hp === 0 ? {color:'#ff4444'} : {color:'#FFF'}]}>{p.current_hp}/{p.max_hp}</Text>
                       </View>
                   </ImageBackground>
               );
           } else {
               // RENDERIZAÇÃO PADRÃO (SEM BANNER)
               return (
                   <View key={p.id} style={[styles.participantRow, isCurrent ? styles.activeRowBorder : {}, {backgroundColor: '#202024'}]}>
                       <View style={{flex: 1}}>
                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                {isCurrent && <Ionicons name="caret-forward" color="#FFD700" size={16} style={{marginRight: 5}} />}
                                <Text style={[styles.pName, {color: isCurrent ? '#FFD700' : '#FFF'}]}>{p.username}</Text>
                            </View>
                            <Text style={[styles.pSubName, {color:'#DDD'}]}>
                                {pChar?.name} 
                                {pChar?.category === 'equipe' && ` (${p.team_state?.length || 0} unidades)`}
                            </Text>
                            {(p.current_shield || 0) > 0 && (<Text style={{color:'#29B6F6', fontSize:10, fontWeight:'bold', marginTop:2}}>🛡️ {p.current_shield}</Text>)}
                            <View style={{flexDirection:'row', flexWrap:'wrap', marginTop:2}}>
                               {p.active_transformations?.map((t, idx) => (<Text key={`t-${idx}`} style={{color:'#FFD700', fontSize:10, marginRight:5}}>★ {t.name}</Text>))}
                               {p.active_buffs?.map((b, idx) => (<Text key={`b-${idx}`} style={{color:'#00B37E', fontSize:10, marginRight:5}}>↑ {b.name}</Text>))}
                               {p.active_debuffs?.map((d, idx) => (<Text key={`d-${idx}`} style={{color:'#ff4444', fontSize:10, marginRight:5}}>↓ {d.name}</Text>))}
                           </View>
                       </View>

                       <View style={{alignItems:'center'}}>
                           {(p.active_debuffs && p.active_debuffs.length > 0) && <Ionicons name="skull" color="#ff4444" size={12} style={{marginBottom: 2}} />}
                           <Text style={[styles.pHp, p.current_hp === 0 ? {color:'#ff4444'} : {color:'#FFF'}]}>{p.current_hp}/{p.max_hp}</Text>
                       </View>
                   </View>
               );
           }
        })}
      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        {isMyTurn ? (
            <TouchableOpacity style={[styles.passTurnButton, {backgroundColor: getPhaseColor(currentPhase)}]} onPress={handlePhaseAction} disabled={processingPhase}>
                {processingPhase ? <ActivityIndicator color="#000" /> : <Text style={styles.passTurnText}>{getButtonLabel(currentPhase)}</Text>}
            </TouchableOpacity>
        ) : (
            <View style={styles.waitingBox}><ActivityIndicator size="small" color="#aaa" style={{marginRight: 10}}/><Text style={styles.waitingText}>Aguardando {currentPlayer?.username} ({getPhaseLabel(room.turn_phase)})</Text></View>
        )} 
        <TouchableOpacity style={styles.exitButton} onPress={handleLeaveRoom}><Text style={{color:'#777'}}>Sair</Text></TouchableOpacity>
      </View>

      <Modal animationType="fade" transparent={true} visible={notificationVisible} onRequestClose={() => setNotificationVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={[styles.styledModalContent, {borderColor: getNotifyColor(), minHeight: 200, justifyContent:'center'}]}>
                <Text style={[styles.styledModalTitle, {color: getNotifyColor(), textAlign:'center', marginBottom:15}]}>{notificationData.title}</Text>
                <Text style={{color:'#fff', fontSize:16, textAlign:'center', marginBottom:25, lineHeight:24}}>{notificationData.message}</Text>
                <View style={{flexDirection:'row', justifyContent:'center'}}>
                    {notificationData.hasCancel && (<TouchableOpacity onPress={notificationData.onCancel} style={{padding:12, marginRight:10}}><Text style={{color:'#777', fontWeight:'bold'}}>{notificationData.cancelText}</Text></TouchableOpacity>)}
                    <TouchableOpacity onPress={notificationData.onConfirm} style={{backgroundColor: getNotifyColor(), paddingVertical:12, paddingHorizontal:30, borderRadius:8}}><Text style={{color:'#000', fontWeight:'bold'}}>{notificationData.confirmText}</Text></TouchableOpacity>
                </View>
            </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={deployMemberModalVisible} onRequestClose={() => { if ((myParticipant?.team_state?.length || 0) > 0) setDeployMemberModalVisible(false) }}>
        <View style={styles.modalOverlay}>
            <View style={[styles.styledModalContent, {borderColor:'#FFD700'}]}>
                <View style={styles.styledModalHeader}>
                    <Text style={[styles.styledModalTitle, {color:'#FFD700'}]}>{(myParticipant?.team_state?.length || 0) === 0 ? "🛡️ CONVOCAR LÍDER" : "⚔️ REFORÇOS"}</Text>
                    {(myParticipant?.team_state?.length || 0) > 0 && (<TouchableOpacity onPress={() => setDeployMemberModalVisible(false)}><Ionicons name="close" size={28} color="#ccc" /></TouchableOpacity>)}
                </View>
                {reserveMembers.length === 0 ? (<Text style={{color:'#777', textAlign:'center', marginVertical:20}}>Sem reserva disponível.</Text>) : (
                    <FlatList data={reserveMembers} keyExtractor={(item, index) => `${item.name}-${index}`} renderItem={({item}) => (
                        <TouchableOpacity style={styles.cardItem} onPress={() => handleAddMemberToField(item)}>
                            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', flex:1}}>
                                <View><Text style={styles.cardName}>{item.name}</Text><Text style={{color:'#777', fontSize:10}}>Reserva</Text></View>
                                <View style={{backgroundColor:'#FFD700', paddingHorizontal:10, paddingVertical:6, borderRadius:8}}><Text style={{color:'#000', fontWeight:'bold', fontSize:12}}>{item.base_hp} HP</Text></View>
                            </View>
                        </TouchableOpacity>
                    )}/>
                )}
            </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent={true} visible={skillsModalVisible} onRequestClose={() => setSkillsModalVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={[styles.styledModalContent, {borderColor:'#8257e5'}]}>
                <View style={styles.styledModalHeader}>
                    <Text style={[styles.styledModalTitle, {color:'#8257e5'}]}>⚡ ARSENAL</Text>
                    <TouchableOpacity onPress={() => setSkillsModalVisible(false)}><Ionicons name="close" size={28} color="#ccc" /></TouchableOpacity>
                </View>
                <ScrollView>
                    {myChar?.category === 'equipe' ? (
                        <View>
                             {myParticipant.team_state && myParticipant.team_state.length > 0 ? (
                                 myParticipant.team_state.map((activeMember, index) => {
                                     const originalMemberData = myChar.team_members?.find(m => m.name === activeMember.name);
                                     const memberSkills = originalMemberData?.skills || [];
                                     return (
                                         <View key={index} style={{marginBottom: 20}}>
                                             <Text style={{color:'#FFF', fontWeight:'bold', fontSize:16, marginBottom:10, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5}}>
                                                 {activeMember.name} (HP: {activeMember.current_hp})
                                             </Text>
                                             {memberSkills.length === 0 ? (
                                                 <Text style={{color:'#777', fontStyle:'italic'}}>Sem habilidades.</Text>
                                             ) : (
                                                 memberSkills.map((s, sIdx) => (
                                                    <TouchableOpacity key={sIdx} style={styles.cardItem} onPress={() => activateSkill(s)}>
                                                        <View style={{flex:1}}>
                                                            <Text style={styles.cardName}>{s.name}</Text>
                                                            <Text style={styles.cardDesc}>{s.description} • {s.cost || '-'}</Text>
                                                        </View>
                                                        <Ionicons name="play-circle" size={24} color="#00B37E" />
                                                    </TouchableOpacity>
                                                 ))
                                             )}
                                         </View>
                                     );
                                 })
                             ) : (
                                 <Text style={{color:'#777', textAlign:'center'}}>Nenhuma unidade ativa.</Text>
                             )}
                        </View>
                    ) : (
                        <>
                            {mySkills.length === 0 && <Text style={{color:'#777', textAlign:'center', marginTop: 20}}>Nenhuma habilidade aprendida.</Text>}
                            {/* ... (Renderização normal para individual) ... */}
                            {mySkills.map((s, idx) => (
                                <TouchableOpacity key={idx} style={styles.cardItem} onPress={() => activateSkill(s)}>
                                    <View style={{flex:1}}><Text style={styles.cardName}>{s.name}</Text><Text style={styles.cardDesc}>{s.description} • {s.cost || '-'}</Text></View>
                                    <Ionicons name="play-circle" size={24} color="#00B37E" />
                                </TouchableOpacity>
                            ))}
                        </>
                    )}
                </ScrollView>
            </View>
        </View>
      </Modal>

      <Modal animationType="slide" transparent={true} visible={effectsListModalVisible} onRequestClose={() => setEffectsListModalVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={[styles.styledModalContent, {borderColor: targetEffectType==='buff' ? '#00B37E' : '#ff4444'}]}>
                <View style={styles.styledModalHeader}>
                    <Text style={[styles.styledModalTitle, {color: targetEffectType==='buff' ? '#00B37E' : '#ff4444'}]}>{targetEffectType === 'buff' ? "🧪 APLICAR BUFF" : "☠️ APLICAR DEBUFF"}</Text>
                    <TouchableOpacity onPress={() => setEffectsListModalVisible(false)}><Ionicons name="close" size={28} color="#ccc" /></TouchableOpacity>
                </View>
                <FlatList data={filteredEffects} keyExtractor={item => item.id} renderItem={({item}) => (
                    <TouchableOpacity style={styles.cardItem} onPress={() => applyStatusEffect(item)}>
                        <View style={{flex:1}}>
                            <Text style={styles.cardName}>{item.title}</Text>
                            <Text style={styles.cardDesc}>{item.description} {item.damage ? `• Dano: ${item.damage}` : ''} {item.duration ? `• ${item.duration} Rnds` : ''}</Text>
                        </View>
                        <Ionicons name="add-circle" size={28} color={targetEffectType==='buff' ? '#00B37E' : '#ff4444'} />
                    </TouchableOpacity>
                )}/>
            </View>
        </View>
      </Modal>

      <Modal animationType="fade" transparent={true} visible={eventModalVisible} onRequestClose={() => setEventModalVisible(false)}>
        <View style={styles.modalOverlay}>
            <View style={[styles.styledModalContent, {borderColor:'#FFD700'}]}>
                <View style={styles.styledModalHeader}>
                    <Text style={[styles.styledModalTitle, {color:'#FFD700'}]}>📜 MISSÃO ATUAL</Text>
                    <TouchableOpacity onPress={() => setEventModalVisible(false)}><Ionicons name="close" size={28} color="#ccc" /></TouchableOpacity>
                </View>
                {gameEvent ? (<ScrollView>
                    {gameEvent.image_url && <Image source={{uri: gameEvent.image_url}} style={{width:'100%', height:200, borderRadius:8, marginBottom:15, borderWidth:1, borderColor:'#333'}} resizeMode='cover' />}
                    <Text style={{color:'#fff', fontSize:22, fontWeight:'bold', marginBottom:10, textAlign:'center'}}>{gameEvent.title}</Text>
                    <Text style={{color:'#ccc', fontSize:16, lineHeight:24, textAlign:'justify'}}>{gameEvent.description}</Text>
                </ScrollView>) : <ActivityIndicator size="large" color="#FFD700" />}
                <TouchableOpacity style={[styles.passTurnButton, {marginTop:20, backgroundColor:'#333'}]} onPress={() => setEventModalVisible(false)}><Text style={{color:'#fff', fontWeight:'bold'}}>ENTENDIDO</Text></TouchableOpacity>
            </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 },
  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  scrollContent: { padding: 20, paddingBottom: 220 }, 
  turnHeader: { backgroundColor: '#202024', paddingHorizontal: 15, paddingBottom: 10, paddingTop: 35, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333', flexDirection:'row', justifyContent:'space-between' },
  myTurnHeader: { backgroundColor: '#3e2e6b', borderBottomColor: '#8257e5' },
  turnText: { color: '#fff', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  missionBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.3)', padding:6, borderRadius:20 },
  missionBtnText: { color:'#fff', fontSize:12, fontWeight:'bold' },
  
  // AREA DO PERSONAGEM (ATUALIZADA)
  charArea: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      marginBottom: 25, 
      marginTop: 10,
      padding: 15,          
      borderRadius: 12,     
      position: 'relative', 
      overflow: 'hidden'    
  },
  
  bannerBackground: {
      ...StyleSheet.absoluteFillObject,
      opacity: 0.6, 
      zIndex: -1, 
  },

  charImageContainer: {
      width: 80,
      height: 80,
      marginRight: 15,
  },

  charImage: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#8257e5' },
  charPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  
  // CAIXA DE TEXTO (TEXT BOX) - USADA NO BANNER PRINCIPAL
  textBox: {
      backgroundColor: 'rgba(0,0,0,0.7)', 
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
      alignSelf: 'flex-start',
  },

  charName: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  charClass: { color: '#8257e5', fontSize: 16 },
  playerNameTag: { color: '#ccc', fontSize: 14, fontStyle: 'italic' },
  
  statsCard: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  label: { color: '#ccc', fontSize: 12, fontWeight: 'bold' },
  hpControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hpBtn: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  hpDisplay: { alignItems: 'center' },
  hpValue: { color: '#fff', fontSize: 42, fontWeight: 'bold' },
  sectionTitle: { color: '#fff', fontSize: 18, marginTop: 20, marginBottom: 10, fontWeight:'bold', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5 },
  
  // LINHA DE PARTICIPANTE COM BANNER (AJUSTADO E LIMPO)
  participantRow: { 
      flexDirection: 'row', 
      justifyContent: 'space-between', 
      padding: 15,  
      alignItems: 'center',
      marginBottom: 10, 
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#333'
  },
  
  activeRowBorder: {
      borderColor: '#FFD700', // Apenas borda dourada para indicar turno
      borderWidth: 2,
  },
  
  rowBannerBackground: {
      ...StyleSheet.absoluteFillObject,
      // Nenhuma opacidade aqui na imagem em si, controlamos no overlay
  },

  rowBannerOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.6)', // Overlay escuro por cima da imagem
  },
  
  // ESTILOS DE TEXTO GARANTIDOS (Branco ou Dourado)
  pName: { color: '#fff', fontSize: 16 },
  pSubName: { color: '#ddd', fontSize: 12 },
  pHp: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#121214', borderTopWidth: 1, borderTopColor: '#333', elevation: 10 },
  passTurnButton: { backgroundColor: '#FFD700', padding: 18, borderRadius: 12, alignItems: 'center', elevation: 5 },
  passTurnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
  waitingBox: { backgroundColor: '#202024', padding: 15, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  waitingText: { color: '#aaa', fontStyle: 'italic' },
  exitButton: { alignItems: 'center', marginTop: 15 },
  skillsButton: { flexDirection:'row', backgroundColor:'#333', padding:15, borderRadius:8, alignItems:'center', justifyContent:'center', marginVertical:10, borderWidth:1, borderColor:'#FFD700' },
  skillsButtonText: { color:'#FFD700', fontWeight:'bold', fontSize:14 },
  
  // ESTILOS NOVOS DOS MODAIS
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding:20 },
  styledModalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 20, maxHeight: '80%', borderWidth: 1, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 20 },
  styledModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems:'center', marginBottom: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
  styledModalTitle: { fontSize: 22, fontWeight: 'bold', letterSpacing: 1 },
  cardItem: { backgroundColor: '#27272A', padding: 15, borderRadius: 12, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardDesc: { color: '#aaa', fontSize: 12, marginTop: 4 },

  skillSection: { marginBottom: 20 },
  skillHeader: { fontSize: 12, fontWeight: 'bold', marginBottom: 10, letterSpacing: 1 },

  activateBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor:'#FFD700' },
  activateText: { color: '#000', fontSize: 10, fontWeight: 'bold' },
  activeTransBadge: { backgroundColor:'rgba(255, 215, 0, 0.2)', borderWidth:1, borderColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:4, marginRight:5, marginBottom:5 },
  activeTransText: { color:'#FFD700', fontSize:12, fontWeight:'bold' },
  phaseDot: { width:6, height:6, borderRadius:3, backgroundColor:'#444', marginHorizontal:2 },
  phaseLine: { width:15, height:2, backgroundColor:'#444' },
  phaseText: { marginLeft: 10, fontSize: 10, fontWeight:'bold', letterSpacing:1 },
  addMemberBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:12 },
  addMemberText: { color:'#000', fontSize:10, fontWeight:'bold' },
  
  teamContainer: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  unitRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5 },
  unitName: { color:'#fff', fontSize:16, fontWeight:'bold', flex:1 },
  unitControls: { flexDirection:'row', alignItems:'center' },
  miniBtn: { width:30, height:30, borderRadius:15, alignItems:'center', justifyContent:'center' },
  unitHp: { color:'#fff', fontSize:18, fontWeight:'bold', marginHorizontal:10 },

  smallCtrlBtn: { width:30, height:30, alignItems:'center', justifyContent:'center', borderRadius:8, borderWidth:1, borderColor:'#555', backgroundColor:'#222' },
  smallCtrlText: { color:'#fff', fontSize:10, fontWeight:'bold' }
});