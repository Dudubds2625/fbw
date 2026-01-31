import React, { useEffect, useState, useRef, useMemo } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, 
  Alert, Image, ActivityIndicator, Modal, FlatList 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { Room, RoomParticipant, GameCharacter, GameEvent, CharacterSkill, TeamMemberState, StatusEffect, ActiveStatusEffect, TeamMember, PartnerMember } from '../types/rpg';
import { Ionicons } from '@expo/vector-icons';
import { RealtimeChannel } from '@supabase/supabase-js';
import PagerView from 'react-native-pager-view';
import EventPanel from './EventPanel';

interface GameScreenProps {
  roomCode: string;
  userId: string;
  onExitGame: () => void;
}

// Interfaces Auxiliares
interface PartnerEvolution { target_level: number; new_name: string; new_base_hp: number; }
interface RenderableSkill { skill: CharacterSkill; locked: boolean; sourceName?: string; reqLevel: number; }
interface BossSkill { name: string; description: string; target: 'players_global' | 'self'; }
interface EventState { current_hp: number; max_hp: number; name: string; image_url?: string; boss_skills?: BossSkill[]; active_enemies?: any[]; }

export default function GameScreen({ roomCode, userId, onExitGame }: GameScreenProps) {
  // ===========================================================================
  // 1. STATES & REFS
  // ===========================================================================
  const [room, setRoom] = useState<Room | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [myParticipant, setMyParticipant] = useState<RoomParticipant | null>(null);
  const [charactersMap, setCharactersMap] = useState<Record<string, GameCharacter>>({});
  const [allCharacters, setAllCharacters] = useState<GameCharacter[]>([]);
   
  const [allRawSkills, setAllRawSkills] = useState<CharacterSkill[]>([]);
  const [mySkills, setMySkills] = useState<CharacterSkill[]>([]);
  const [currentLevel, setCurrentLevel] = useState(1); 

  const [catalogEffects, setCatalogEffects] = useState<StatusEffect[]>([]); 
  const [challengesCompletedMap, setChallengesCompletedMap] = useState<Record<string, boolean>>({});

  // ESTADO DO EVENTO (BOSS)
  const [gameEvent, setGameEvent] = useState<GameEvent | null>(null); 
  const [eventState, setEventState] = useState<EventState | null>(null);

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
   
  const currentEventIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const prevTurnIdRef = useRef<string | null>(null);
  const skillsLoadedRef = useRef(false);
  const hasShownEventRef = useRef(false);
   
  const blockUpdateRef = useRef(false);
  const pagerRef = useRef<PagerView>(null);

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

  // ===========================================================================
  // 2. VARIÁVEIS DERIVADAS
  // ===========================================================================
  const currentPlayer = participants.find(p => p.id === room?.current_turn_participant_id);
  const isMyTurn = room?.current_turn_participant_id === myParticipant?.id;
  const currentPhase = room?.turn_phase || 'initial';
   
  const myChar = myParticipant?.selected_character_id ? charactersMap[myParticipant.selected_character_id] : null;
  const activeUnits = (myParticipant?.team_state as TeamMemberState[]) || [];
   
  const reserveMembers = (myChar?.team_members || []).filter(m => !activeUnits.some(u => u.name === m.name));
   
  const filteredEffects = catalogEffects.filter(e => e.type === targetEffectType);
  const myBannerActive = (myParticipant?.challenge_completed || (myParticipant && challengesCompletedMap[`${myParticipant.user_id}_${myParticipant.selected_character_id}`])) && myChar?.challenge_banner_url;

  const isTransformedHit = (myParticipant?.active_transformations || []).some(t => {
      const skill = allRawSkills.find(s => s.name === t.name);
      return skill?.is_hit_based;
  });
  const isHitMode = myChar?.category === 'hit' || (myParticipant?.pre_transformation_hp !== null && myParticipant?.pre_transformation_hp !== undefined);

  // SKILLS COMBINADAS
  const combinedSkills: RenderableSkill[] = useMemo(() => {
      const result: RenderableSkill[] = [];
      mySkills.forEach(s => { result.push({ skill: s, locked: false, reqLevel: s.unlock_level || 1 }); });
      activeUnits.forEach(unitState => {
          const originalPartnerData = myChar?.team_members?.find(m => m.name === unitState.name);
          if (originalPartnerData && originalPartnerData.skills) {
              originalPartnerData.skills.forEach(s => {
                  const reqLevel = s.unlock_level || 1;
                  const unitLevel = unitState.current_level || 1;
                  const isLocked = unitLevel < reqLevel;
                  result.push({ skill: { ...s, name: `[${unitState.name}] ${s.name}` }, locked: isLocked, sourceName: unitState.name, reqLevel: reqLevel });
              });
          }
      });
      return result;
  }, [mySkills, activeUnits, myChar]);

  // ===========================================================================
  // 3. HELPER FUNCTIONS
  // ===========================================================================
  const getNotifyColor = () => { switch(notificationData.type) { case 'victory': return '#FFD700'; case 'damage': return '#ff4444'; default: return '#8257e5'; } };
  const getVisualDuration = (dur: number, type: 'buff' | 'debuff' | 'trans') => { if (dur < 0) return '∞'; if (dur <= 0) return '∞'; if (type === 'debuff') return `${dur}`; return `${Math.max(dur - 1, 0)}`; };
  const getPhaseLabel = (phase?: string) => { switch(phase) { case 'main': return "MAIN"; case 'end': return "END"; default: return "INIT"; } };
  const getButtonLabel = (phase?: string) => { switch(phase) { case 'initial': return "MAIN 🛡️"; case 'main': return "END 🏁"; case 'end': return "TURN ⏭️"; default: return "INICIAR"; } };
  const getPhaseColor = (phase?: string) => { switch(phase) { case 'main': return "#00B37E"; case 'end': return "#FFD700"; default: return "#8257e5"; } };
  const getSkillSubtypeLabel = (type?: string) => { switch(type) { case 'general': return 'EQUIPE'; case 'transformed': return 'TRANSF.'; default: return 'INDIV.'; } };
  const getSkillSubtypeColor = (type?: string) => { switch(type) { case 'general': return '#00B37E'; case 'transformed': return '#ff4444'; default: return '#8257e5'; } };

  const showCustomAlert = (title: string, message: string, type: 'info'|'damage'|'victory' = 'info', onConfirm?: () => void, hasCancel = false, onCancel?: () => void, confirmText = 'CONFIRMAR', cancelText = 'CANCELAR') => {
      setNotificationData({ title, message, type, onConfirm: () => { setNotificationVisible(false); if (onConfirm) onConfirm(); }, hasCancel, onCancel: () => { setNotificationVisible(false); if (onCancel) onCancel(); }, confirmText, cancelText });
      setNotificationVisible(true);
  };

  const handleLeaveRoom = async () => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    await supabase.from('room_participants').delete().eq('room_code', roomCode).eq('user_id', userId);
    onExitGame();
  };

  const checkTurnChange = async (currentTurnParticipantId: string) => { 
      const myId = participants.find(p => p.user_id === userId)?.id; 
      if (myId && prevTurnIdRef.current && prevTurnIdRef.current !== myId && currentTurnParticipantId === myId) { 
          console.log("⚡ É MEU TURNO!"); 
      } 
      prevTurnIdRef.current = currentTurnParticipantId; 
  };

  // ===========================================================================
  // 4. CORE LOGIC (Definidas ANTES do useEffect)
  // ===========================================================================

  const fetchGameData = async () => {
    try {
        const { data: roomData } = await supabase.from('rooms').select('*').eq('code', roomCode).maybeSingle();
        if (!roomData) { onExitGame(); return; }
        setRoom(roomData);
        if (roomData.event_state) setEventState(roomData.event_state);

        const { data: parts } = await supabase.from('room_participants').select('*').eq('room_code', roomCode).order('turn_order', { ascending: true });
        if (parts) {
            setParticipants(parts);
            const me = parts.find(p => p.user_id === userId);
            if (me) {
                if (!blockUpdateRef.current) {
                    setMyParticipant(me);
                    if (me.current_hp !== hp && !processingPhase) setHp(me.current_hp);
                    if (me.max_hp !== maxHp) setMaxHp(me.max_hp);
                }
                if (me.selected_character_id && (!skillsLoadedRef.current || me.selected_character_id !== myParticipant?.selected_character_id)) {
                    const { data: skills } = await supabase.from('character_skills').select('*').eq('character_id', me.selected_character_id);
                    if (skills) { setAllRawSkills(skills); setMySkills(skills.filter(s => (s.unlock_level || 1) <= (me.current_level || 1))); skillsLoadedRef.current = true; }
                    const { data: char } = await supabase.from('game_characters').select('*').eq('id', me.selected_character_id).single();
                    if(char) setCharactersMap(prev => ({...prev, [char.id]: char}));
                }
            }
            const missingCharIds = parts.map(p => p.selected_character_id).filter(id => id && !charactersMap[id]);
            if(missingCharIds.length > 0) {
                const {data: chars} = await supabase.from('game_characters').select('*').in('id', missingCharIds as string[]);
                if(chars) {
                    const newMap = {...charactersMap};
                    chars.forEach(c => newMap[c.id] = c);
                    setCharactersMap(newMap);
                }
            }
        }

        if (roomData.selected_event_id && roomData.selected_event_id !== currentEventIdRef.current) {
            const { data: ev } = await supabase.from('game_events').select('*').eq('id', roomData.selected_event_id).single();
            if (ev) {
                setGameEvent(ev);
                currentEventIdRef.current = ev.id;
                if (!roomData.event_state) {
                    const initialState = {
                        current_hp: ev.base_hp || 0,
                        max_hp: ev.base_hp || 0,
                        name: ev.enemy_name || ev.title,
                        image_url: ev.image_url,
                        active_enemies: [] 
                    };
                    await supabase.from('rooms').update({ event_state: initialState }).eq('code', roomCode);
                }
                if (!hasShownEventRef.current) { setEventModalVisible(true); hasShownEventRef.current = true; }
            }
        }
    } catch (e) { console.log(e); }
  };

  const subscribeToGame = () => {
    const channel = supabase.channel(`game_${roomCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, payload => {
            const newRoom = payload.new as Room;
            setRoom(newRoom);
            if (newRoom.event_state) setEventState(newRoom.event_state);
            if (newRoom.selected_event_id && newRoom.selected_event_id !== currentEventIdRef.current) fetchGameData(); 
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${roomCode}` }, () => fetchGameData())
      .subscribe();
    channelRef.current = channel;
  };

  // ===========================================================================
  // 5. EFFECTS (USAM AS FUNÇÕES ACIMA)
  // ===========================================================================
  
  // Agora fetchGameData e subscribeToGame JÁ existem
  useEffect(() => {
    fetchGameData();
    subscribeToGame();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, []);

  useEffect(() => {
      if (allRawSkills.length > 0) {
          const unlocked = allRawSkills.filter(s => (s.unlock_level || 1) <= currentLevel);
          setMySkills(unlocked);
      }
  }, [currentLevel, allRawSkills]);

  useEffect(() => {
    if (!myParticipant) return;
    const myCharId = myParticipant.selected_character_id;
    if (!myCharId) return;
    const char = charactersMap[myCharId];
    if (!char) return; 

    if (!initialCheckDone) {
        if (char.category === 'equipe') {
            const units = myParticipant.team_state || [];
            if (units.length === 0) {
                setDeployMemberModalVisible(true);
            }
        }
        setInitialCheckDone(true); 
    }
  }, [myParticipant, charactersMap, initialCheckDone]);

  useEffect(() => {
    if (myParticipant && room && initialCheckDone) {
        checkAndApplyPassives();
    }
  }, [
      myParticipant?.team_state, 
      myParticipant?.active_transformations, 
      initialCheckDone, 
      myParticipant?.selected_character_id,
      mySkills
  ]);

  // ===========================================================================
  // 6. ACTION HANDLERS
  // ===========================================================================

  const processEndTurnLogic = async () => {
      if (!myParticipant) return;
        
      const isHitModeLocal = (myChar?.category === 'hit') || (myParticipant.pre_transformation_hp !== null && myParticipant.pre_transformation_hp !== undefined);

      let updatedTrans = [...(myParticipant.active_transformations || [])];
      let transExpired: string[] = [];
      let hitFormExpired = false;

      updatedTrans = updatedTrans.map(t => { 
          if (t.rounds_left === -1) return t; 
          return { ...t, rounds_left: t.rounds_left - 1 }; 
      }).filter(t => { 
          if (t.rounds_left === -1) return true; 
          if (t.rounds_left <= 0) { 
              transExpired.push(t.name); 
              const skill = allRawSkills.find(s => s.name === t.name);
              if (skill?.is_hit_based) { hitFormExpired = true; }
              return false; 
          } 
          return true; 
      });

      let updatedBuffs = [...(myParticipant.active_buffs || [])];
      let buffsExpired: string[] = [];
      updatedBuffs = updatedBuffs.map(b => { 
          if (b.duration === -1) return b; 
          return { ...b, duration: b.duration - 1 }; 
      }).filter(b => { 
          if (b.duration === -1) return true; 
          if (b.duration < 0) return true; 
          if (b.duration <= 0) { buffsExpired.push(b.name); return false; } 
          return true; 
      });

      let updatedDebuffs = [...(myParticipant.active_debuffs || [])];
      let debuffsExpired: string[] = [];
      let totalDamageTaken = 0;
      let damageSources: string[] = [];
        
      updatedDebuffs = updatedDebuffs.map(d => {
          if (d.damage) {
              const dmgVal = parseInt(d.damage.toString()); 
              if (!isNaN(dmgVal) && dmgVal > 0) {
                  let finalDmg = dmgVal;
                  if (isHitModeLocal) { finalDmg = 1; }
                  totalDamageTaken += finalDmg;
                  damageSources.push(`${d.name} (-${finalDmg})`);
              }
          }
          return { ...d, duration: d.duration - 1 };
      }).filter(d => { if (d.duration <= 0) { debuffsExpired.push(d.name); return false; } return true; });

      let currentShield = shield;
      let currentHp = hp;
      let finalTeamState = [...activeUnits];

      if (totalDamageTaken > 0) {
          let damageAfterShield = totalDamageTaken;
          if (currentShield >= damageAfterShield) {
              currentShield -= damageAfterShield;
              damageAfterShield = 0;
          } else {
              damageAfterShield -= currentShield;
              currentShield = 0;
          }

          if (myChar?.category === 'equipe' && damageAfterShield > 0) {
              finalTeamState = finalTeamState.map(unit => {
                  if (damageAfterShield > 0 && unit.current_hp > 0) {
                      const dmgToUnit = Math.min(unit.current_hp, damageAfterShield);
                      unit.current_hp -= dmgToUnit;
                      damageAfterShield -= dmgToUnit;
                  }
                  return unit;
              }).filter(u => u.current_hp > 0); 
              currentHp = finalTeamState.reduce((acc, u) => acc + u.current_hp, 0);
          } else if (damageAfterShield > 0) {
              currentHp = Math.max(0, currentHp - damageAfterShield);
          }
      }
        
      blockUpdateRef.current = true;

      const payload: any = { 
          active_transformations: updatedTrans, 
          active_buffs: updatedBuffs, 
          active_debuffs: updatedDebuffs, 
          current_hp: currentHp, 
          current_shield: currentShield 
      };

      if (myChar?.category === 'equipe') { payload.team_state = finalTeamState; }

      if (hitFormExpired && myParticipant.pre_transformation_hp) {
          const originalHp = myParticipant.pre_transformation_hp;
          const originalMaxHp = myChar?.base_hp || 10;
          payload.pre_transformation_hp = null; 
          payload.current_hp = originalHp;      
          payload.max_hp = originalMaxHp;       
          setHp(originalHp); setMaxHp(originalMaxHp); setShield(currentShield); 
          setMyParticipant(prev => prev ? ({ ...prev, pre_transformation_hp: null, current_hp: originalHp, max_hp: originalMaxHp, active_transformations: updatedTrans }) : null);
      } else {
          setShield(currentShield); setHp(currentHp);
      }

      await supabase.from('room_participants').update(payload).eq('id', myParticipant.id);
      setTimeout(() => { blockUpdateRef.current = false; }, 1500);

      let msgParts = [];
      if (totalDamageTaken > 0) msgParts.push(`💥 Dano de Debuffs: ${totalDamageTaken} (${damageSources.join(', ')}).`);
      if (transExpired.length > 0) msgParts.push(`❌ Transformações encerradas: ${transExpired.join(', ')}.`);
      if (buffsExpired.length > 0) msgParts.push(`📉 Buffs expirados: ${buffsExpired.join(', ')}.`);
      if (debuffsExpired.length > 0) msgParts.push(`✨ Debuffs removidos: ${debuffsExpired.join(', ')}.`);
      if (msgParts.length > 0) { showCustomAlert("RESUMO DA FASE", msgParts.join('\n\n'), 'damage'); }
  };

  const checkAndApplyPassives = async () => {
      if (!myParticipant || !myChar) return;

      const isTransformed = (myParticipant.active_transformations?.length || 0) > 0;
      const currentBuffs = myParticipant.active_buffs || [];
      const temporaryBuffs = currentBuffs.filter(b => b.duration !== -1);
      const newPassivesMap = new Map<string, ActiveStatusEffect>();

      const evaluateSkill = (skill: CharacterSkill, memberState?: TeamMemberState) => {
          if (skill.type !== 'passive') return;

          if (memberState) {
              const reqLevel = skill.unlock_level || 1;
              const memLevel = memberState.current_level || 1;
              if (memLevel < reqLevel) return; 
          }

          const pType = skill.passive_type; 
          let isOwnerActive = true;
            
          if ((myChar.category === 'equipe' || activeUnits.length > 0) && memberState) {
              isOwnerActive = activeUnits.some(u => u.name === memberState.name);
          }

          let shouldBeActive = false;

          if (isTransformed) {
              if (pType === 'transformed') shouldBeActive = isOwnerActive;
              else if (pType === 'general_transformed') shouldBeActive = true;
              else if (pType === 'general') shouldBeActive = true; 
              else shouldBeActive = false;
          } else {
              if (pType === 'individual' || !pType) shouldBeActive = isOwnerActive;
              else if (pType === 'general') shouldBeActive = true;
              else shouldBeActive = false;
          }

          if (shouldBeActive) {
              const isGen = (pType === 'general' || pType === 'general_transformed');
              const prefix = isGen ? '[GERAL]' : (memberState ? `[${memberState.name}]` : '');
              const transfTag = (pType === 'transformed' || pType === 'general_transformed') ? ' (Transf.)' : '';
              const buffName = `${prefix} ${skill.name}${transfTag}`.trim();
              
              newPassivesMap.set(buffName, {
                  name: buffName, description: skill.description, duration: -1
              });
          }
      };

      if ((myChar.category === 'equipe' || activeUnits.length > 0) && myChar.team_members) {
          myChar.team_members.forEach(m => {
              const mState = activeUnits.find(u => u.name === m.name);
              if (mState && m.skills) {
                  m.skills.forEach(s => evaluateSkill(s, mState));
              }
          });
      } 
        
      if (mySkills.length > 0) {
          mySkills.forEach(s => evaluateSkill(s));
      }

      const calculatedPassives = Array.from(newPassivesMap.values());
      const finalBuffList = [...temporaryBuffs, ...calculatedPassives];
        
      const currentBuffStr = JSON.stringify(currentBuffs.sort((a,b) => a.name.localeCompare(b.name)));
      const newBuffStr = JSON.stringify(finalBuffList.sort((a,b) => a.name.localeCompare(b.name)));

      if (currentBuffStr !== newBuffStr) {
          await supabase.from('room_participants').update({ active_buffs: finalBuffList }).eq('id', myParticipant.id);
      }
  };

  const changeHp = async (amount: number) => { 
      if (!myParticipant) return;
      let finalAmount = amount;
      if (isHitMode && amount < 0) { finalAmount = -1; }

      const newVal = Math.max(0, Math.min(maxHp, hp + finalAmount)); 
        
      setHp(newVal); 
      blockUpdateRef.current = true;
      setMyParticipant(prev => prev ? ({...prev, current_hp: newVal}) : null);

      await supabase.from('room_participants').update({ current_hp: newVal }).eq('id', myParticipant.id);
      setTimeout(() => { blockUpdateRef.current = false; }, 1000);
  };

  const changeMaxHp = async (amount: number) => { 
      if (!myParticipant) return;
      const newVal = Math.max(1, maxHp + amount); 
      setMaxHp(newVal); 
      const fixedHp = Math.min(hp, newVal); 
      if (fixedHp !== hp) setHp(fixedHp); 
      blockUpdateRef.current = true;
      await supabase.from('room_participants').update({ max_hp: newVal, current_hp: fixedHp }).eq('id', myParticipant.id);
      setTimeout(() => { blockUpdateRef.current = false; }, 1000);
  };

  const changeShield = async (amount: number) => { 
      if (!myParticipant) return; 
      const newVal = Math.max(0, shield + amount); 
      setShield(newVal); 
      await supabase.from('room_participants').update({ current_shield: newVal }).eq('id', myParticipant.id); 
  };

  const handleLevelChange = async (delta: number) => {
      const newLevel = Math.max(1, currentLevel + delta);
      if (newLevel === currentLevel) return;
      setCurrentLevel(newLevel);
      await supabase.from('room_participants').update({ current_level: newLevel }).eq('id', myParticipant?.id);
  };

  const changeUnitLevel = async (index: number, delta: number) => {
      if (!myParticipant || !myParticipant.team_state) return;
      const newState = [...activeUnits];
      const unit = { ...newState[index] };
      const currentLvl = unit.current_level || 1;
      const newLvl = Math.max(1, currentLvl + delta);
      if (newLvl === currentLvl) return;
        
      const originalPartner = myChar?.team_members?.find(m => m.name === unit.name) as PartnerMember;
        
      if (originalPartner && originalPartner.evolutions) {
          const evolution = originalPartner.evolutions.find((ev: PartnerEvolution) => ev.target_level === newLvl);
          if (evolution) {
              Alert.alert(
                  "Evolução Disponível!",
                  `${unit.name} pode evoluir para ${evolution.new_name}.\nVida Base: ${evolution.new_base_hp}.\n\nAplicar evolução agora?`,
                  [
                      { 
                          text: "Ainda não", 
                          onPress: async () => {
                              unit.current_level = newLvl;
                              newState[index] = unit;
                              await supabase.from('room_participants').update({ team_state: newState }).eq('id', myParticipant.id);
                          }
                      },
                      {
                          text: "EVOLUIR!",
                          onPress: async () => {
                              unit.current_level = newLvl;
                              unit.name = evolution.new_name;
                              unit.max_hp = evolution.new_base_hp;
                              unit.current_hp = evolution.new_base_hp;
                              newState[index] = unit;
                              await supabase.from('room_participants').update({ team_state: newState }).eq('id', myParticipant.id);
                              showCustomAlert("Evolução!", `${originalPartner.name} evoluiu para ${evolution.new_name}!`, 'victory');
                          }
                      }
                  ]
              );
              return;
          }
      }

      unit.current_level = newLvl;
      newState[index] = unit;
      await supabase.from('room_participants').update({ team_state: newState }).eq('id', myParticipant.id);
  };

  const changeUnitHp = async (index: number, amount: number) => {
      if (!myParticipant || !myParticipant.team_state) return;
      const newState = [...activeUnits];
      const unit = { ...newState[index] }; 
        
      let finalAmount = amount;
      if (isHitMode && amount < 0) { finalAmount = -1; }

      const newUnitVal = Math.max(0, Math.min(unit.max_hp, unit.current_hp + finalAmount));
        
      if (newUnitVal <= 0) { 
          newState.splice(index, 1); 
      } else { 
          unit.current_hp = newUnitVal;
          newState[index] = unit; 
      }
        
      const payload: any = { team_state: newState };
        
      if (myChar?.category === 'equipe') {
          const newGlobalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
          setHp(newGlobalHp);
          payload.current_hp = newGlobalHp;
      }
        
      await supabase.from('room_participants').update(payload).eq('id', myParticipant.id);
  };

  const changeUnitMaxHp = async (index: number, amount: number) => {
      if (!myParticipant || !myParticipant.team_state) return;
      const newState = [...activeUnits];
      const unit = { ...newState[index] }; 
      const newMax = Math.max(1, unit.max_hp + amount);
      unit.max_hp = newMax;
      if (unit.current_hp > newMax) { unit.current_hp = newMax; }
      newState[index] = unit;
        
      const payload: any = { team_state: newState };

      if (myChar?.category === 'equipe') {
          const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0); 
          const newGlobalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
          setHp(newGlobalHp); setMaxHp(totalMaxHp);
          payload.current_hp = newGlobalHp;
          payload.max_hp = totalMaxHp;
      }
        
      await supabase.from('room_participants').update(payload).eq('id', myParticipant.id);
  };

  const handleAddMemberToField = async (member: TeamMember) => {
      if (!myParticipant) return;
      const currentState = [...activeUnits];
      const newUnit: TeamMemberState = { name: member.name, current_hp: member.base_hp, max_hp: member.base_hp, current_level: 1 };
      const newState = [...currentState, newUnit];
        
      const payload: any = { team_state: newState };

      if (myChar?.category === 'equipe') {
          const newGlobalHp = newState.reduce((acc, u) => acc + u.current_hp, 0);
          const totalMaxHp = newState.reduce((acc, u) => acc + u.max_hp, 0);
          setHp(newGlobalHp); setMaxHp(totalMaxHp);
          payload.current_hp = newGlobalHp;
          payload.max_hp = totalMaxHp;
      }
        
      await supabase.from('room_participants').update(payload).eq('id', myParticipant.id);
      setDeployMemberModalVisible(false);
  };

  const handleRemovePassive = (skillId: string) => { setMySkills(prev => prev.filter(s => s.id !== skillId)); };
  const handlePressPassive = (skill: CharacterSkill) => { showCustomAlert(skill.name, skill.description, 'info', () => handleRemovePassive(skill.id), true, undefined, "REMOVER", "FECHAR"); };
  const removeStatusEffect = async (effectName: string, type: 'buff' | 'debuff') => { if (!myParticipant) return; if (type === 'buff') { const newArr = (myParticipant.active_buffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_buffs: newArr }).eq('id', myParticipant.id); } else { const newArr = (myParticipant.active_debuffs || []).filter(e => e.name !== effectName); await supabase.from('room_participants').update({ active_debuffs: newArr }).eq('id', myParticipant.id); } };
  const handlePressStatusEffect = (effect: ActiveStatusEffect, type: 'buff' | 'debuff') => { let detailText = effect.description ? effect.description : "Sem descrição."; detailText += `\n\nDuração: ${getVisualDuration(effect.duration, type)}`; if(effect.damage) detailText += `\nDano: ${effect.damage}`; showCustomAlert(effect.name, detailText, type === 'buff' ? 'info' : 'damage', () => removeStatusEffect(effect.name, type), true, undefined, "REMOVER", "FECHAR"); };
   
  const activateSkill = async (skill: CharacterSkill) => { 
    if (skill.type === 'transformation') { 
        const currentList = myParticipant?.active_transformations || []; 
        if (currentList.some(t => t.name === skill.name)) { showCustomAlert("Ops", `${skill.name} já está ativa.`); return; } 
        
        let durationToSave = 4; 
        if (skill.duration === -1) { durationToSave = -1; } 
        else if (skill.duration && skill.duration > 0) { durationToSave = skill.duration + 1; } 
        
        const newList = [...currentList, { name: skill.name, rounds_left: durationToSave }]; 
        
        const hitVal = Number(skill.hit_value);
        const isHit = skill.is_hit_based && !isNaN(hitVal) && hitVal > 0;
        const updatePayload: any = { active_transformations: newList };
        
        if (isHit) {
            updatePayload.pre_transformation_hp = myParticipant?.current_hp || 1;
            if (myParticipant) { setMyParticipant({ ...myParticipant, active_transformations: newList, pre_transformation_hp: myParticipant.current_hp || 1 }); }
        } else {
            if (myParticipant) { setMyParticipant({ ...myParticipant, active_transformations: newList }); }
        }
        await supabase.from('room_participants').update(updatePayload).eq('id', myParticipant?.id);
        const durText = durationToSave === -1 ? 'Infinito' : `${durationToSave-1}`;
        if (isHit) { showCustomAlert("Transformação HIT!", `${skill.name} ativada. \n\nO sistema ajustará automaticamente qualquer dano para 1 HIT.\n\nPor favor, ajuste sua vida inicial para ${hitVal}.`, 'info'); } else { showCustomAlert("Transformação!", `${skill.name} ativada por ${durText} rodadas.`, 'info'); }
    } else { 
        const newBuffs = buffs ? `${buffs}, ${skill.name}` : skill.name; setBuffs(newBuffs); await supabase.from('room_participants').update({ buffs: newBuffs }).eq('id', myParticipant?.id); showCustomAlert("Habilidade", `${skill.name} usada!`, 'info'); 
    } 
    setSkillsModalVisible(false); 
  };

  const removeTransformation = async (transName: string) => { 
      if(!myParticipant) return; 
      const newList = (myParticipant.active_transformations || []).filter(t => t.name !== transName); 
      const skill = allRawSkills.find(s => s.name === transName);
      const wasHit = skill?.is_hit_based || (myParticipant.pre_transformation_hp !== null);
      const stillHit = newList.some(t => { const s = allRawSkills.find(sk => sk.name === t.name); return !!s?.is_hit_based; });
      const updatePayload: any = { active_transformations: newList };
      let didRevert = false;

      if (wasHit && !stillHit) {
          const originalHp = myParticipant.pre_transformation_hp || 10;
          const originalMaxHp = myChar?.base_hp || 10;
           
          setMyParticipant(prev => prev ? ({ 
              ...prev, 
              active_transformations: newList, 
              pre_transformation_hp: null, // Limpa flag local
              current_hp: originalHp, 
              max_hp: originalMaxHp 
          }) : null);
           
          setHp(originalHp); 
          setMaxHp(originalMaxHp); 
          blockUpdateRef.current = true;
           
          updatePayload.pre_transformation_hp = null; 
          updatePayload.current_hp = originalHp; 
          updatePayload.max_hp = originalMaxHp;
          didRevert = true; 
           
          setTimeout(() => { blockUpdateRef.current = false; }, 1000);
      } else {
          setMyParticipant(prev => prev ? ({ ...prev, active_transformations: newList }) : null);
      }
       
      await supabase.from('room_participants').update(updatePayload).eq('id', myParticipant.id);
       
      if (didRevert) { showCustomAlert("Destransformar", `Transformação ${transName} removida. Voltando à forma normal.`, 'info'); } 
      else { showCustomAlert("Info", `Transformação ${transName} removida.`, 'info'); }
  };

  const openEffectList = (type: 'buff' | 'debuff') => { setTargetEffectType(type); setEffectsListModalVisible(true); };
  const applyStatusEffect = async (effect: StatusEffect) => { if (!myParticipant) return; const baseDuration = (effect.duration && effect.duration > 0) ? effect.duration : 0; const finalDuration = targetEffectType === 'buff' ? (baseDuration > 0 ? baseDuration + 1 : 0) : baseDuration; const newEffect: ActiveStatusEffect = { name: effect.title, description: effect.description, damage: effect.damage, duration: finalDuration }; if (targetEffectType === 'buff') { const currentBuffs = myParticipant.active_buffs || []; if (currentBuffs.some(b => b.name === newEffect.name)) { showCustomAlert("Repetido", "Já possui esse buff."); return; } await supabase.from('room_participants').update({ active_buffs: [...currentBuffs, newEffect] }).eq('id', myParticipant.id); } else { const currentDebuffs = myParticipant.active_debuffs || []; if (currentDebuffs.some(d => d.name === newEffect.name)) { showCustomAlert("Repetido", "Já possui esse debuff."); return; } await supabase.from('room_participants').update({ active_debuffs: [...currentDebuffs, newEffect] }).eq('id', myParticipant.id); } setEffectsListModalVisible(false); };
  const handleConfirmVictory = async () => { if (!myParticipant || !room) return; const myCharId = myParticipant.selected_character_id; const myCharLocal = myCharId ? charactersMap[myCharId] : null; try { const createdTime = new Date(room.created_at).getTime(); const endTime = new Date().getTime(); const durationSeconds = Math.floor((endTime - createdTime) / 1000); await supabase.from('victories').insert({ user_id: userId, character_name: myCharLocal?.name || myParticipant.username, session_name: roomCode, victory_date: new Date().toISOString() }); await supabase.from('match_history').insert({ room_code: roomCode, winner_name: myParticipant.username, winner_character: myCharLocal?.name || 'Desconhecido', duration_seconds: durationSeconds, participants_snapshot: participants }); if (myCharId) { const { error: levelError } = await supabase.rpc('increment_char_level', { uid: userId, char_id: myCharId }); if (levelError) { const { data: roster } = await supabase.from('user_roster').select('current_level').eq('user_id', userId).eq('character_id', myCharId).single(); if (roster) { await supabase.from('user_roster').update({ current_level: roster.current_level + 1 }).eq('user_id', userId).eq('character_id', myCharId); } } } showCustomAlert("🏆 Lenda!", "Vitória registrada! Nível Subiu!", 'victory', handleLeaveRoom); } catch (error: any) { showCustomAlert("Erro", error.message); } };

  const handlePhaseAction = async () => {
    if (!room || !participants.length || !room.current_turn_participant_id) return;
    if (myParticipant && room.current_turn_participant_id !== myParticipant.id) return;
    setProcessingPhase(true);
    try {
        const currentPhase = room.turn_phase || 'initial';
        if (currentPhase === 'initial') { await supabase.from('rooms').update({ turn_phase: 'main' }).eq('code', roomCode); } 
        else if (currentPhase === 'main') {
            await processEndTurnLogic(); 
            await supabase.from('rooms').update({ turn_phase: 'end' }).eq('code', roomCode);
        } else {
            const currentIndex = participants.findIndex(p => p.id === room.current_turn_participant_id);
            const nextIndex = (currentIndex + 1) % participants.length;
            await supabase.from('rooms').update({ current_turn_participant_id: participants[nextIndex].id, turn_phase: 'initial' }).eq('code', roomCode);
        }
    } catch (error) { showCustomAlert("Erro", "Falha ao mudar de fase."); } finally { setProcessingPhase(false); }
  };

  // ===========================================================================
  // 7. RENDER
  // ===========================================================================

  if (!myParticipant || !room) return <View style={styles.loading}><ActivityIndicator size="large" color="#8257e5" /><Text style={{color:'#fff'}}>Carregando...</Text><TouchableOpacity onPress={onExitGame} style={{marginTop:20, padding:10, backgroundColor:'#333', borderRadius:8}}><Text style={{color:'#fff'}}>Sair</Text></TouchableOpacity></View>;

  return (
    <View style={{flex: 1}}>
        <PagerView style={{flex: 1, backgroundColor: '#121214'}} initialPage={0} ref={pagerRef}>
            
            {/* PÁGINA 1: JOGO */}
            <View key="1" style={styles.container}>
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
                    <TouchableOpacity style={styles.missionBtn} onPress={() => pagerRef.current?.setPage(1)}>
                        <Ionicons name="skull" color="#000" size={14} />
                        <Text style={styles.missionBtnText}> EVENTO ➔</Text>
                    </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={styles.scrollContent}>
                    {/* BANNER PRINCIPAL DO JOGADOR */}
                    <View style={[styles.charArea, !myBannerActive && {backgroundColor: '#2A2A2E'}]}>
                        {myBannerActive && ( <Image source={{ uri: myChar?.challenge_banner_url }} style={styles.bannerBackground} resizeMode="cover" /> )}
                        {myBannerActive && <View style={styles.bannerOverlay} />}
                        <View style={styles.charImageContainer}>
                            {myChar?.image_url ? <Image source={{ uri: myChar.image_url }} style={styles.charImage} /> : <View style={styles.charPlaceholder}><Ionicons name="person" size={40} color="#fff" /></View>}
                        </View>
                        <View style={{flex:1}}>
                            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
                            <View style={[styles.textBox, { marginBottom: 5 }]}><Text style={styles.charName}>{myChar?.name || 'Unknown'}</Text></View>
                            {/* CONTROLE DE LEVEL UP/DOWN (INDIVIDUAL) */}
                            {(myChar?.category !== 'equipe' && myChar?.has_level_system) && (
                                <View style={{flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.6)', padding:4, borderRadius:8, borderWidth:1, borderColor:'#FFD700', marginLeft: 10}}>
                                    <TouchableOpacity onPress={() => handleLevelChange(-1)} style={{paddingHorizontal:6, paddingVertical:2}}><Ionicons name="remove" size={16} color="#FFD700"/></TouchableOpacity>
                                    <Text style={{color:'#FFD700', fontWeight:'bold', fontSize:14, marginHorizontal:2}}>Lv {currentLevel}</Text>
                                    <TouchableOpacity onPress={() => handleLevelChange(1)} style={{paddingHorizontal:6, paddingVertical:2}}><Ionicons name="add" size={16} color="#FFD700"/></TouchableOpacity>
                                </View>
                            )}
                            </View>
                            {myBannerActive && (<View style={[styles.textBox, {backgroundColor: 'rgba(255, 215, 0, 0.2)', borderWidth:1, borderColor:'#FFD700', marginBottom:2}]}><View style={{flexDirection:'row', alignItems:'center'}}><Ionicons name="trophy" size={10} color="#FFD700" style={{marginRight:4}}/><Text style={{color:'#FFD700', fontSize:10, fontWeight:'bold'}}>DESAFIO COMPLETO</Text></View></View>)}
                            <View style={{flexDirection:'row', flexWrap:'wrap'}}><View style={styles.textBox}><Text style={styles.playerNameTag}>({myParticipant?.username})</Text></View>{myChar?.category && (<View style={[styles.textBox, {marginLeft:5}]}><Text style={[styles.playerNameTag, {color:'#FFD700', fontWeight:'bold'}]}>{myChar.category.toUpperCase()}</Text></View>)}</View>
                        </View>
                    </View>

                    {myChar?.category === 'equipe' ? (
                        <View style={styles.teamContainer}>
                            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                                <Text style={styles.label}>UNIDADES ATIVAS</Text>
                                <TouchableOpacity onPress={() => setDeployMemberModalVisible(true)} style={styles.addMemberBtn}><Ionicons name="add" size={16} color="#000" /><Text style={styles.addMemberText}> Invocar</Text></TouchableOpacity>
                            </View>
                            {activeUnits.length === 0 ? (
                                <TouchableOpacity style={{backgroundColor:'rgba(255, 215, 0, 0.1)', borderWidth:1, borderColor:'#FFD700', padding:20, borderRadius:8, alignItems:'center', borderStyle:'dashed', marginTop:10}} onPress={() => setDeployMemberModalVisible(true)}><Ionicons name="people" size={32} color="#FFD700" /><Text style={{color:'#FFD700', fontWeight:'bold', marginTop:10}}>NENHUMA UNIDADE EM CAMPO</Text><Text style={{color:'#aaa', fontSize:12, marginTop:5}}>Toque para invocar seu primeiro membro</Text></TouchableOpacity>
                            ) : (
                                activeUnits.map((unit, idx) => (
                                    <View key={`${unit.name}-${idx}`} style={[styles.unitRow, {flexDirection: 'column', alignItems: 'stretch'}]}>
                                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                                            <Text style={styles.unitName}>{unit.name}</Text>
                                            {myChar.has_level_system && (
                                                <View style={{flexDirection:'row', alignItems:'center', backgroundColor:'#222', borderRadius:6, padding:2, borderWidth:1, borderColor:'#FFD700'}}>
                                                    <TouchableOpacity onPress={() => changeUnitLevel(idx, -1)} style={{padding:4}}><Ionicons name="remove" size={12} color="#FFD700"/></TouchableOpacity>
                                                    <Text style={{color:'#FFD700', fontSize:12, fontWeight:'bold', marginHorizontal:6}}>Lv {unit.current_level || 1}</Text>
                                                    <TouchableOpacity onPress={() => changeUnitLevel(idx, 1)} style={{padding:4}}><Ionicons name="add" size={12} color="#FFD700"/></TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
                                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                                <Text style={{color:'#777', fontSize:10, marginRight:4}}>Max:</Text>
                                                <TouchableOpacity onPress={() => changeUnitMaxHp(idx, -1)}><Ionicons name="remove-circle" size={20} color="#555"/></TouchableOpacity>
                                                <Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:4}}>{unit.max_hp}</Text>
                                                <TouchableOpacity onPress={() => changeUnitMaxHp(idx, 1)}><Ionicons name="add-circle" size={20} color="#555"/></TouchableOpacity>
                                            </View>
                                            <View style={styles.unitControls}>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, -10)} style={[styles.miniBtn, {backgroundColor:'#330000', width:28, height:28, marginRight:4}]}><Text style={{color:'#ff4444', fontSize:10, fontWeight:'bold'}}>-10</Text></TouchableOpacity>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, -1)} style={[styles.miniBtn, {backgroundColor:'#ff4444', width:28, height:28}]}><Ionicons name="remove" size={16} color="#fff"/></TouchableOpacity>
                                                <Text style={styles.unitHp}>{unit.current_hp}</Text>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, 1)} style={[styles.miniBtn, {backgroundColor:'#00B37E', width:28, height:28}]}><Ionicons name="add" size={16} color="#fff"/></TouchableOpacity>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, 10)} style={[styles.miniBtn, {backgroundColor:'#003300', width:28, height:28, marginLeft:4}]}><Text style={{color:'#00B37E', fontSize:10, fontWeight:'bold'}}>+10</Text></TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                ))
                            )}
                            <View style={{marginTop: 15, padding: 10, backgroundColor: '#18181B', borderRadius: 8, borderWidth:1, borderColor:'#333', alignItems:'center'}}>
                                <Text style={{color:'#777', fontSize:10, textAlign:'center', marginBottom:5}}>HP TOTAL DO EXÉRCITO:</Text>
                                <Text style={{color:'#fff', fontSize:24, fontWeight:'bold'}}>{hp}</Text>
                            </View>
                        </View>
                    ) : (
                        <>
                            {maxShield > 0 && (<View style={[styles.statsCard, {borderColor: '#29B6F6', borderWidth: 1}]}><View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}><Text style={[styles.label, {color:'#29B6F6'}]}>ESCUDO</Text><Text style={{color:'#29B6F6', fontWeight:'bold'}}>Max: {maxShield}</Text></View><View style={styles.hpControls}><TouchableOpacity onPress={() => changeShield(-10)} style={styles.smallCtrlBtn}><Text style={styles.smallCtrlText}>-10</Text></TouchableOpacity><TouchableOpacity onPress={() => changeShield(-1)} style={[styles.hpBtn, {backgroundColor: '#333', borderWidth:1, borderColor:'#29B6F6'}]}><Ionicons name="remove" size={32} color="#29B6F6" /></TouchableOpacity><View style={styles.hpDisplay}><Text style={[styles.hpValue, {color:'#29B6F6'}]}>{shield}</Text></View><TouchableOpacity onPress={() => changeShield(1)} style={[styles.hpBtn, {backgroundColor: '#333', borderWidth:1, borderColor:'#29B6F6'}]}><Ionicons name="add" size={32} color="#29B6F6" /></TouchableOpacity><TouchableOpacity onPress={() => changeShield(10)} style={styles.smallCtrlBtn}><Text style={styles.smallCtrlText}>+10</Text></TouchableOpacity></View></View>)}
                            <View style={styles.statsCard}><View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}><Text style={styles.label}>{isHitMode ? "HITS (TRANSF.)" : (myChar?.category === 'hit' ? "HITS (VIDA FIXA)" : "HP")}</Text><View style={{flexDirection:'row', alignItems:'center'}}><Text style={[styles.label, {color:'#777', marginRight:5}]}>Max:</Text><TouchableOpacity onPress={() => changeMaxHp(-1)}><Ionicons name="remove-circle" color="#555" size={24}/></TouchableOpacity><Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:5, fontSize:16}}>{maxHp}</Text><TouchableOpacity onPress={() => changeMaxHp(1)}><Ionicons name="add-circle" color="#555" size={24}/></TouchableOpacity></View></View><View style={styles.hpControls}><TouchableOpacity onPress={() => changeHp(-10)} style={[styles.smallCtrlBtn, {backgroundColor:'#330000'}]}><Text style={[styles.smallCtrlText, {color:'#ff4444'}]}>-10</Text></TouchableOpacity><TouchableOpacity onPress={() => changeHp(-1)} style={[styles.hpBtn, {backgroundColor: '#ff4444'}]}><Ionicons name="remove" size={32} color="#fff" /></TouchableOpacity><View style={styles.hpDisplay}><Text style={styles.hpValue}>{hp}</Text></View><TouchableOpacity onPress={() => changeHp(1)} style={[styles.hpBtn, {backgroundColor: '#00B37E'}]}><Ionicons name="add" size={32} color="#fff" /></TouchableOpacity><TouchableOpacity onPress={() => changeHp(10)} style={[styles.smallCtrlBtn, {backgroundColor:'#003300'}]}><Text style={[styles.smallCtrlText, {color:'#00B37E'}]}>+10</Text></TouchableOpacity></View></View>
                        </>
                    )}

                    {myChar?.category !== 'equipe' && (
                        <View style={{marginBottom: 15}}>
                            <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                                <Text style={{color:'#aaa', fontWeight:'bold', fontSize:12}}>PARCEIROS / INVOCAÇÕES</Text>
                                {reserveMembers.length > 0 && (
                                    <TouchableOpacity onPress={() => setDeployMemberModalVisible(true)} style={styles.addMemberBtn}>
                                        <Ionicons name="add" size={14} color="#000" /><Text style={styles.addMemberText}> Invocar</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {activeUnits.length > 0 ? (
                                activeUnits.map((unit, idx) => {
                                    const originalPartnerData = myChar?.team_members?.find(m => m.name === unit.name) as PartnerMember;
                                    const hasLevel = originalPartnerData?.has_level_system;
                                    return (
                                    <View key={`${unit.name}-${idx}`} style={[styles.unitRow, {backgroundColor: '#202024', padding: 10, borderRadius: 8, flexDirection: 'column', alignItems: 'stretch'}]}>
                                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                                            <Text style={styles.unitName}>{unit.name}</Text>
                                            {!!hasLevel && (
                                                <View style={{flexDirection:'row', alignItems:'center', backgroundColor:'#222', borderRadius:6, padding:2, borderWidth:1, borderColor:'#FFD700'}}>
                                                    <TouchableOpacity onPress={() => changeUnitLevel(idx, -1)} style={{padding:4}}><Ionicons name="remove" size={12} color="#FFD700"/></TouchableOpacity>
                                                    <Text style={{color:'#FFD700', fontSize:12, fontWeight:'bold', marginHorizontal:6}}>Lv {unit.current_level || 1}</Text>
                                                    <TouchableOpacity onPress={() => changeUnitLevel(idx, 1)} style={{padding:4}}><Ionicons name="add" size={12} color="#FFD700"/></TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center'}}>
                                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                                <Text style={{color:'#777', fontSize:10, marginRight:4}}>Max:</Text>
                                                <TouchableOpacity onPress={() => changeUnitMaxHp(idx, -1)}><Ionicons name="remove-circle" size={18} color="#555"/></TouchableOpacity>
                                                <Text style={{color:'#fff', fontWeight:'bold', marginHorizontal:4}}>{unit.max_hp}</Text>
                                                <TouchableOpacity onPress={() => changeUnitMaxHp(idx, 1)}><Ionicons name="add-circle" size={18} color="#555"/></TouchableOpacity>
                                            </View>
                                            <View style={styles.unitControls}>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, -10)} style={[styles.miniBtn, {backgroundColor:'#330000', width:26, height:26, marginRight:4}]}><Text style={{color:'#ff4444', fontSize:10, fontWeight:'bold'}}>-10</Text></TouchableOpacity>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, -1)} style={[styles.miniBtn, {backgroundColor:'#ff4444', width:26, height:26}]}><Ionicons name="remove" size={14} color="#fff"/></TouchableOpacity>
                                                <Text style={[styles.unitHp, {fontSize:16}]}>{unit.current_hp}</Text>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, 1)} style={[styles.miniBtn, {backgroundColor:'#00B37E', width:26, height:26}]}><Ionicons name="add" size={14} color="#fff"/></TouchableOpacity>
                                                <TouchableOpacity onPress={() => changeUnitHp(idx, 10)} style={[styles.miniBtn, {backgroundColor:'#003300', width:26, height:26, marginLeft:4}]}><Text style={{color:'#00B37E', fontSize:10, fontWeight:'bold'}}>+10</Text></TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                )})
                            ) : (
                                <Text style={{color:'#555', fontStyle:'italic', textAlign:'center', fontSize:12, marginBottom:10}}>Nenhum parceiro em campo.</Text>
                            )}
                        </View>
                    )}

                    <View style={[styles.statsCard, {marginBottom:10}]}>
                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                            <Text style={[styles.label, {color:'#00B37E', marginBottom:0}]}>BUFFS / PASSIVAS</Text>
                            <TouchableOpacity onPress={() => openEffectList('buff')}><Ionicons name="add-circle" size={24} color="#00B37E" /></TouchableOpacity>
                        </View>
                        <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                            {(!myParticipant?.active_buffs?.length && !buffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum buff ou passiva ativa.</Text> : null}
                            {myParticipant?.active_buffs?.map((b, idx) => {
                                const isTransformedBuff = b.name.includes('(Transf.)');
                                const color = isTransformedBuff ? '#FF8800' : '#00B37E';
                                const bgColor = isTransformedBuff ? 'rgba(255, 136, 0, 0.2)' : 'rgba(0, 179, 126, 0.1)';
                                return (
                                    <TouchableOpacity key={`ab-${idx}`} style={[styles.activeTransBadge, {borderColor: color, backgroundColor: bgColor, flexDirection:'row', alignItems:'center'}]} onPress={() => handlePressStatusEffect(b, 'buff')}>
                                        <Text style={[styles.activeTransText, {color: color, marginRight:5}]}>{b.name} ({getVisualDuration(b.duration, 'buff')})</Text>
                                        <Ionicons name="information-circle-outline" size={14} color={color} />
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    <View style={[styles.statsCard, {marginBottom:10}]}>
                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:5}}>
                            <Text style={[styles.label, {color:'#ff4444', marginBottom:0}]}>DEBUFFS</Text>
                            <TouchableOpacity onPress={() => openEffectList('debuff')}><Ionicons name="add-circle" size={24} color="#ff4444" /></TouchableOpacity>
                        </View>
                        <View style={{flexDirection:'row', flexWrap:'wrap', minHeight: 30}}>
                            {(!myParticipant?.active_debuffs?.length && !debuffs) ? <Text style={{color:'#555', fontStyle:'italic', fontSize:12, marginTop:5}}>Nenhum debuff.</Text> : null}
                            {myParticipant?.active_debuffs?.map((d, idx) => (
                                <TouchableOpacity key={`ad-${idx}`} style={[styles.activeTransBadge, {borderColor:'#ff4444', backgroundColor:'rgba(255, 68, 68, 0.1)', flexDirection:'row', alignItems:'center'}]} onPress={() => handlePressStatusEffect(d, 'debuff')}>
                                    <Text style={[styles.activeTransText, {color:'#ff4444', marginRight:5}]}>{d.name} {d.damage ? `[${d.damage}]` : ''} ({getVisualDuration(d.duration, 'debuff')})</Text>
                                    <Ionicons name="information-circle-outline" size={14} color="#ff4444" />
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    {myParticipant?.active_transformations && myParticipant.active_transformations.length > 0 && (
                        <View style={[styles.statsCard, {marginBottom:10}]}>
                            <Text style={[styles.label, {color:'#FFD700', marginBottom:5}]}>TRANSFORMAÇÕES:</Text>
                            <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                                {myParticipant.active_transformations.map((t, idx) => (
                                    <TouchableOpacity key={`t-${idx}`} style={styles.activeTransBadge} onPress={() => removeTransformation(t.name)}>
                                        <Text style={styles.activeTransText}>{t.name} ({getVisualDuration(t.rounds_left, 'trans')} rnds) ✖️</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}

                    <TouchableOpacity style={styles.skillsButton} onPress={() => setSkillsModalVisible(true)}><Ionicons name="flash" size={20} color="#FFD700" style={{marginRight:10}} /><Text style={styles.skillsButtonText}>HABILIDADES & TRANSFORMAÇÕES</Text></TouchableOpacity>

                    <Text style={styles.sectionTitle}>Grupo</Text>
                    {participants.map(p => {
                    const pChar = p.selected_character_id ? charactersMap[p.selected_character_id] : null;
                    const isCurrent = room?.current_turn_participant_id === p.id;
                    const showRowBanner = (p.challenge_completed || challengesCompletedMap[`${p.user_id}_${p.selected_character_id}`]) && pChar?.challenge_banner_url;

                    return (
                        <View key={p.id} style={[styles.participantRow, isCurrent ? styles.activeRowBorder : {}, !showRowBanner && {backgroundColor: '#202024'}]}>
                            {showRowBanner && <Image source={{ uri: pChar?.challenge_banner_url }} style={styles.rowBannerBackground} resizeMode="cover" />}
                            {showRowBanner && <View style={styles.rowBannerOverlay} />}
                            <View style={{flex: 1}}>
                                <View style={{flexDirection:'row', alignItems:'center'}}>
                                    {isCurrent && <Ionicons name="caret-forward" color="#FFD700" size={16} style={{marginRight: 5}} />}
                                    <Text style={[styles.pName, {color: isCurrent ? '#FFD700' : '#FFF'}]}>{p.username}</Text>
                                </View>
                                <Text style={[styles.pSubName, {color:'#DDD'}]}>{pChar?.name} {pChar?.category === 'equipe' && ` (${p.team_state?.length || 0} unidades)`}</Text>
                                {(p.current_shield || 0) > 0 && (<Text style={{color:'#29B6F6', fontSize:10, fontWeight:'bold', marginTop:2}}>🛡️ {p.current_shield}</Text>)}
                                <View style={{flexDirection:'row', flexWrap:'wrap', marginTop:2}}>
                                    {p.active_transformations?.map((t, idx) => (<Text key={`t-${idx}`} style={{color:'#FFD700', fontSize:10, marginRight:5}}>★ {t.name}</Text>))}
                                    {p.active_buffs?.map((b, idx) => (<Text key={`b-${idx}`} style={{color:'#00B37E', fontSize:10, marginRight:5}}>↑ {b.name}</Text>))}
                                    {p.active_debuffs?.map((d, idx) => (<Text key={`d-${idx}`} style={{color:'#ff4444', fontSize:10, marginRight:5}}>↓ {d.name}</Text>))}
                                </View>
                            </View>
                            <View style={{alignItems:'center', justifyContent:'center', minWidth:40}}>
                                {(p.active_debuffs && p.active_debuffs.length > 0) && <Ionicons name="skull" color="#ff4444" size={12} style={{marginBottom: 2}} />}
                                <Text style={[styles.pHp, p.current_hp === 0 ? {color:'#ff4444'} : {color:'#FFF'}]}>{p.current_hp}/{p.max_hp}</Text>
                            </View>
                        </View>
                    )
                    })}
                </ScrollView>

                <View style={styles.footer}>
                    {isMyTurn ? (
                        <TouchableOpacity style={[styles.passTurnButton, {backgroundColor: getPhaseColor(currentPhase)}]} onPress={handlePhaseAction} disabled={processingPhase}>
                            {processingPhase ? <ActivityIndicator color="#000" /> : <Text style={styles.passTurnText}>{getButtonLabel(currentPhase)}</Text>}
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.waitingBox}><ActivityIndicator size="small" color="#aaa" style={{marginRight: 10}}/><Text style={styles.waitingText}>Aguardando {currentPlayer?.username} ({getPhaseLabel(room?.turn_phase)})</Text></View>
                    )} 
                    <TouchableOpacity style={styles.exitButton} onPress={handleLeaveRoom}><Text style={{color:'#777'}}>Sair</Text></TouchableOpacity>
                </View>
            </View>

            {/* PÁGINA 2: O NOVO PAINEL DO EVENTO */}
            <View key="2" style={{flex: 1}}>
                <EventPanel room={room} /> 
            </View>

        </PagerView>
        
        {/* MODAIS (Skills, Effects, etc.) */}
        <Modal visible={skillsModalVisible} animationType="slide" transparent={true} onRequestClose={() => setSkillsModalVisible(false)}>
            <View style={styles.modalOverlay}>
            <View style={styles.styledModalContent}>
                <View style={styles.styledModalHeader}>
                <Text style={styles.styledModalTitle}>HABILIDADES</Text>
                <TouchableOpacity onPress={() => setSkillsModalVisible(false)}><Ionicons name="close" size={24} color="#fff"/></TouchableOpacity>
                </View>
                <FlatList 
                data={combinedSkills}
                keyExtractor={(item, idx) => `${item.skill.id}-${idx}`}
                renderItem={({item}) => (
                    <TouchableOpacity 
                    style={[styles.cardItem, item.locked && {opacity: 0.5}]} 
                    onPress={() => { if(!item.locked) { if(item.skill.type === 'passive') handlePressPassive(item.skill); else activateSkill(item.skill); } else { showCustomAlert("Bloqueado", `Nível ${item.reqLevel} necessário.`); } }}
                    >
                    <View style={{flex: 1}}>
                        <Text style={[styles.cardName, {color: item.locked ? '#777' : '#fff'}]}>{item.skill.name}</Text>
                        <Text style={styles.cardDesc}>{item.skill.description}</Text>
                        <View style={{flexDirection:'row', marginTop:4}}>
                            <Text style={{color: getSkillSubtypeColor(item.skill.passive_type), fontSize:10, fontWeight:'bold', marginRight:8}}>{getSkillSubtypeLabel(item.skill.passive_type)}</Text>
                            {(item.skill.duration || 0) > 0 && <Text style={{color:'#aaa', fontSize:10}}>Dur: {item.skill.duration} rnds</Text>}
                        </View>
                    </View>
                    {item.locked ? <Ionicons name="lock-closed" color="#555" size={20} /> : (item.skill.type === 'passive' ? <Ionicons name="eye" color="#00B37E" size={20} /> : <View style={styles.activateBadge}><Text style={styles.activateText}>USAR</Text></View>)}
                    </TouchableOpacity>
                )}
                />
            </View>
            </View>
        </Modal>

        <Modal visible={effectsListModalVisible} animationType="fade" transparent={true} onRequestClose={() => setEffectsListModalVisible(false)}>
            <View style={styles.modalOverlay}>
            <View style={styles.styledModalContent}>
                <View style={styles.styledModalHeader}>
                <Text style={styles.styledModalTitle}>ADICIONAR {targetEffectType === 'buff' ? 'BUFF' : 'DEBUFF'}</Text>
                <TouchableOpacity onPress={() => setEffectsListModalVisible(false)}><Ionicons name="close" size={24} color="#fff"/></TouchableOpacity>
                </View>
                <FlatList 
                data={filteredEffects}
                keyExtractor={(item) => item.id}
                renderItem={({item}) => (
                    <TouchableOpacity style={styles.cardItem} onPress={() => applyStatusEffect(item)}>
                    <View>
                        <Text style={styles.cardName}>{item.title}</Text>
                        <Text style={styles.cardDesc}>{item.description}</Text>
                        <Text style={{color:'#777', fontSize:10, marginTop:2}}>Duração base: {item.duration} | Dano: {item.damage || 0}</Text>
                    </View>
                    <Ionicons name="add-circle" size={24} color={targetEffectType === 'buff' ? '#00B37E' : '#ff4444'} />
                    </TouchableOpacity>
                )}
                />
            </View>
            </View>
        </Modal>

        <Modal visible={deployMemberModalVisible} animationType="slide" transparent={true} onRequestClose={() => setDeployMemberModalVisible(false)}>
            <View style={styles.modalOverlay}>
            <View style={styles.styledModalContent}>
                <View style={styles.styledModalHeader}>
                <Text style={styles.styledModalTitle}>INVOCAR MEMBRO</Text>
                <TouchableOpacity onPress={() => setDeployMemberModalVisible(false)}><Ionicons name="close" size={24} color="#fff"/></TouchableOpacity>
                </View>
                {reserveMembers.length === 0 ? (
                <Text style={{color:'#aaa', textAlign:'center', marginTop:20}}>Todos os membros disponíveis já estão em campo.</Text>
                ) : (
                <FlatList 
                    data={reserveMembers}
                    keyExtractor={(item) => item.name}
                    renderItem={({item}) => (
                    <TouchableOpacity style={styles.cardItem} onPress={() => handleAddMemberToField(item)}>
                        <View>
                        <Text style={styles.cardName}>{item.name}</Text>
                        <Text style={styles.cardDesc}>HP Base: {item.base_hp}</Text>
                        </View>
                        <Ionicons name="add-circle" size={24} color="#FFD700" />
                    </TouchableOpacity>
                    )}
                />
                )}
            </View>
            </View>
        </Modal>

        <Modal visible={notificationVisible} transparent={true} animationType="fade" onRequestClose={() => { if(notificationData.hasCancel) notificationData.onCancel(); else notificationData.onConfirm(); }}>
            <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'center', alignItems:'center', padding:20}}>
            <View style={{backgroundColor:'#202024', borderRadius:16, padding:20, width:'100%', maxWidth:400, borderWidth:1, borderColor: getNotifyColor()}}>
                <Text style={{color: getNotifyColor(), fontSize:20, fontWeight:'bold', marginBottom:10, textAlign:'center'}}>{notificationData.title}</Text>
                <Text style={{color:'#fff', fontSize:16, textAlign:'center', marginBottom:20}}>{notificationData.message}</Text>
                <View style={{flexDirection:'row', justifyContent:'center'}}>
                {notificationData.hasCancel && (
                    <TouchableOpacity onPress={notificationData.onCancel} style={{paddingVertical:10, paddingHorizontal:20, borderRadius:8, backgroundColor:'#333', marginRight:10}}>
                    <Text style={{color:'#fff', fontWeight:'bold'}}>{notificationData.cancelText}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity onPress={notificationData.onConfirm} style={{paddingVertical:10, paddingHorizontal:20, borderRadius:8, backgroundColor: getNotifyColor()}}>
                    <Text style={{color:'#121214', fontWeight:'bold'}}>{notificationData.confirmText}</Text>
                </TouchableOpacity>
                </View>
            </View>
            </View>
        </Modal>

        <Modal visible={eventModalVisible} animationType="fade" transparent={true} onRequestClose={() => setEventModalVisible(false)}>
            <View style={{flex:1, backgroundColor:'rgba(0,0,0,0.9)', justifyContent:'center', alignItems:'center', padding:20}}>
                <View style={{width:'100%', alignItems:'center'}}>
                    <Text style={{color:'#FFD700', fontSize:28, fontWeight:'bold', marginBottom:20, textAlign:'center', textShadowColor:'rgba(255, 215, 0, 0.5)', textShadowRadius:10}}>EVENTO INICIADO!</Text>
                    {gameEvent?.image_url && <Image source={{ uri: gameEvent.image_url }} style={{width:'100%', height:200, borderRadius:12, marginBottom:20, borderWidth:2, borderColor:'#FFD700'}} resizeMode="cover" />}
                    <Text style={{color:'#fff', fontSize:22, fontWeight:'bold', marginBottom:10}}>{gameEvent?.title}</Text>
                    <Text style={{color:'#ccc', textAlign:'center', marginBottom:30}}>{gameEvent?.description}</Text>
                    <TouchableOpacity onPress={() => setEventModalVisible(false)} style={{backgroundColor:'#FFD700', paddingHorizontal:30, paddingVertical:15, borderRadius:8}}>
                        <Text style={{color:'#000', fontWeight:'bold', fontSize:16}}>VAMOS LÁ!</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    </View>
  );
}

// STYLES (MANTIDOS ORIGINAIS)
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121214', paddingTop: 50 }, // Mantido paddingTop original
  loading: { flex: 1, backgroundColor: '#121214', justifyContent:'center', alignItems:'center' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 220 },
   
  turnHeader: { backgroundColor: '#202024', paddingHorizontal: 15, paddingBottom: 10, paddingTop: 35, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333', flexDirection:'row', justifyContent:'space-between' },
  myTurnHeader: { backgroundColor: '#3e2e6b', borderBottomColor: '#8257e5' },
  turnText: { color: '#fff', fontSize: 14, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  missionBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.3)', padding:6, borderRadius:20 },
  missionBtnText: { color:'#fff', fontSize:12, fontWeight:'bold' },
   
  phaseDot: { width:6, height:6, borderRadius:3, backgroundColor:'#444', marginHorizontal:2 },
  phaseLine: { width:15, height:2, backgroundColor:'#444' },
  phaseText: { marginLeft: 10, fontSize: 10, fontWeight:'bold', letterSpacing:1 },

  charArea: { flexDirection: 'row', alignItems: 'center', marginBottom: 25, marginTop: 10, padding: 15, borderRadius: 12, position: 'relative', overflow: 'hidden' },
  bannerBackground: { ...StyleSheet.absoluteFillObject, opacity: 0.6, zIndex: -1 },
  bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.06)', zIndex: -1 },
  charImageContainer: { width: 80, height: 80, marginRight: 15 },
  charImage: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: '#8257e5' },
  charPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center' },
  textBox: { backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, alignSelf: 'flex-start' },
  charName: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  charClass: { color: '#8257e5', fontSize: 16 },
  playerNameTag: { color: '#ccc', fontSize: 14, fontStyle: 'italic' },
   
  statsCard: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  label: { color: '#ccc', fontSize: 12, fontWeight: 'bold' },
  hpControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hpBtn: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  hpDisplay: { alignItems: 'center' },
  hpValue: { color: '#fff', fontSize: 42, fontWeight: 'bold' },
   
  smallCtrlBtn: { width:30, height:30, alignItems:'center', justifyContent:'center', borderRadius:8, borderWidth:1, borderColor:'#555', backgroundColor:'#222' },
  smallCtrlText: { color:'#fff', fontSize:10, fontWeight:'bold' },

  sectionTitle: { color: '#fff', fontSize: 18, marginTop: 20, marginBottom: 10, fontWeight:'bold', borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5 },
  participantRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, alignItems: 'center', marginBottom: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#333', position: 'relative' },
  activeRowBorder: { borderColor: '#FFD700', borderWidth: 2 },
  rowBannerBackground: { ...StyleSheet.absoluteFillObject, zIndex: -2 },
  rowBannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.06)', zIndex: -1 },
  pName: { color: '#fff', fontSize: 16 },
  pSubName: { color: '#ddd', fontSize: 12 },
  pHp: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
   
  footer: { 
      position: 'absolute', 
      bottom: 0, 
      left: 0, 
      right: 0, 
      backgroundColor: '#121214', 
      borderTopWidth: 1, 
      borderTopColor: '#333', 
      elevation: 10,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 50 
  },
  passTurnButton: { backgroundColor: '#FFD700', padding: 18, borderRadius: 12, alignItems: 'center', elevation: 5 },
  passTurnText: { color: '#000', fontWeight: 'bold', fontSize: 16 },
  waitingBox: { backgroundColor: '#202024', padding: 15, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  waitingText: { color: '#aaa', fontStyle: 'italic' },
  exitButton: { alignItems: 'center', marginTop: 15 },
   
  skillsButton: { flexDirection:'row', backgroundColor:'#333', padding:15, borderRadius:8, alignItems:'center', justifyContent:'center', marginVertical:10, borderWidth:1, borderColor:'#FFD700' },
  skillsButtonText: { color:'#FFD700', fontWeight:'bold', fontSize:14 },
   
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
   
  addMemberBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:12 },
  addMemberText: { color:'#000', fontSize:10, fontWeight:'bold' },
  teamContainer: { backgroundColor: '#202024', borderRadius: 12, padding: 15, marginBottom: 15 },
  unitRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10, borderBottomWidth:1, borderBottomColor:'#333', paddingBottom:5 },
  unitName: { color:'#fff', fontSize:16, fontWeight:'bold', flex:1 },
  unitControls: { flexDirection:'row', alignItems:'center' },
  unitHp: { color:'#fff', fontSize:18, fontWeight:'bold', marginHorizontal:10 },
   
  miniBtn: { width:30, height:30, borderRadius:15, alignItems:'center', justifyContent:'center' }
});