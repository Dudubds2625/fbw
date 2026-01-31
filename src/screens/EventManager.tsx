import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, TextInput, Alert, Image, ScrollView, Switch, ActivityIndicator, KeyboardAvoidingView, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { GameEvent, EventCharacter, CharacterSkill, EventItem } from '../types/rpg';

interface FactionSkillEntry { round: number; skill: CharacterSkill; }
interface LocalFaction { id: string; name: string; skills: FactionSkillEntry[]; }
interface EventManagerProps { visible: boolean; onClose: () => void; }

export default function EventManager({ visible, onClose }: EventManagerProps) {
  // STATES GERAIS
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [createMode, setCreateMode] = useState(false);

  // STATES FORMULÁRIO
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDesc, setNewEventDesc] = useState('');
  const [newEventImage, setNewEventImage] = useState('');
  const [pickedEventImageUri, setPickedEventImageUri] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  // MODO DE JOGO
  const [isFactionEvent, setIsFactionEvent] = useState(false);
  const [hasThreeUnitsRule, setHasThreeUnitsRule] = useState(false);

  // DADOS
  const [eventFactions, setEventFactions] = useState<LocalFaction[]>([]);
  const [factionCountInput, setFactionCountInput] = useState('4');
  const [eventCharacters, setEventCharacters] = useState<EventCharacter[]>([]);
  const [hasItems, setHasItems] = useState(false);
  const [eventItems, setEventItems] = useState<EventItem[]>([]);
  const [hasPassives, setHasPassives] = useState(false);
  const [eventPassives, setEventPassives] = useState<CharacterSkill[]>([]);

  // SUB-MODAIS STATES
  const [createEventCharModalVisible, setCreateEventCharModalVisible] = useState(false);
  const [editingEventCharIndex, setEditingEventCharIndex] = useState<number | null>(null);
  const [evCharName, setEvCharName] = useState('');
  const [evCharHp, setEvCharHp] = useState('10');
  const [evCharHasLife, setEvCharHasLife] = useState(true);
  const [evCharIsBoss, setEvCharIsBoss] = useState(false);
  const [evCharBecomesBoss, setEvCharBecomesBoss] = useState(false);
  const [evCharStartsOnBoard, setEvCharStartsOnBoard] = useState(false);
  const [evCharSkills, setEvCharSkills] = useState<CharacterSkill[]>([]);
  
  // SKILL FORM
  const [editingEvCharSkillIndex, setEditingEvCharSkillIndex] = useState<number | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCost, setSkillCost] = useState('');
  const [skillDuration, setSkillDuration] = useState('');
  
  // CORREÇÃO: Tipos ajustados para incluir transformação e remover summon deste contexto se desejado
  const [skillType, setSkillType] = useState<'active' | 'passive' | 'transformation'>('active');
  
  const [skillCombatState, setSkillCombatState] = useState<'normal' | 'boss'>('normal'); 
  
  // Condição da Passiva (Normal ou Transformado)
  const [skillCondition, setSkillCondition] = useState<'normal' | 'transformed'>('normal');
  
  // Alvo da Passiva (Buff em si ou Debuff Global)
  const [passiveTarget, setPassiveTarget] = useState<'self' | 'global'>('self');

  // Outros Modais (Mantidos simplificados)
  const [editFactionModalVisible, setEditFactionModalVisible] = useState(false);
  const [currentEditingFactionId, setCurrentEditingFactionId] = useState<string | null>(null);
  const [currentFactionName, setCurrentFactionName] = useState('');
  const [currentFactionSkills, setCurrentFactionSkills] = useState<FactionSkillEntry[]>([]);
  const [selectFactionSkillModalVisible, setSelectFactionSkillModalVisible] = useState(false);
  const [factionSkillRoundInput, setFactionSkillRoundInput] = useState('1');
  const [factionSkillName, setFactionSkillName] = useState('');
  const [factionSkillDesc, setFactionSkillDesc] = useState('');
  const [createItemModalVisible, setCreateItemModalVisible] = useState(false);
  const [editingItemIndex, setEditingItemIndex] = useState<number | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemDamage, setItemDamage] = useState('');
  const [itemHasAmmo, setItemHasAmmo] = useState(false);
  const [itemAmmoCount, setItemAmmoCount] = useState('');
  const [createPassiveModalVisible, setCreatePassiveModalVisible] = useState(false);
  const [editingPassiveIndex, setEditingPassiveIndex] = useState<number | null>(null);
  const [passiveName, setPassiveName] = useState('');
  const [passiveDesc, setPassiveDesc] = useState('');

  useEffect(() => { if (visible) fetchEvents(); }, [visible]);

  const fetchEvents = async () => {
    setLoading(true);
    const { data } = await supabase.from('game_events').select('*').order('title');
    if (data) setEvents(data);
    setLoading(false);
  };

  const uploadToSupabase = async (uri: string): Promise<string | null> => {
    try {
      setUploadingImage(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const arrayBuffer = decode(base64);
      const fileExt = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const { error } = await supabase.storage.from('rpg-images').upload(fileName, arrayBuffer, { contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}` });
      if (error) throw error;
      const { data } = supabase.storage.from('rpg-images').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (e: any) { Alert.alert("Erro Upload", e.message); return null; } 
    finally { setUploadingImage(false); }
  };

  const pickEventImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [16, 9], quality: 0.5 });
    if (!result.canceled) setPickedEventImageUri(result.assets[0].uri);
  };

  // --- ACTIONS ---
  const openCreateEvent = () => { setEditingEventId(null); setNewEventTitle(''); setNewEventDesc(''); setNewEventImage(''); setPickedEventImageUri(''); setEventCharacters([]); setIsFactionEvent(false); setHasThreeUnitsRule(false); setEventFactions([]); setFactionCountInput('4'); setHasItems(false); setEventItems([]); setHasPassives(false); setEventPassives([]); setCreateMode(true); };

  const openEditEvent = (ev: GameEvent) => {
      setEditingEventId(ev.id); setNewEventTitle(ev.title); setNewEventDesc(ev.description); setNewEventImage(ev.image_url||''); setPickedEventImageUri('');
      const isFaction = !!ev.is_faction_event; setIsFactionEvent(isFaction); setHasThreeUnitsRule(!!ev.has_three_units_boss_rule);
      const rawFactions = ev.factions as unknown as LocalFaction[] || [];
      const loadedFactions = JSON.parse(JSON.stringify(rawFactions));
      const rawChars = ev.event_characters || [];
      const loadedChars = JSON.parse(JSON.stringify(rawChars));
      if (isFaction) { setEventFactions(loadedFactions); setFactionCountInput(String(loadedFactions.length>0?loadedFactions.length:4)); setEventCharacters([]); } 
      else { setEventCharacters(loadedChars); setEventFactions([]); setFactionCountInput('4'); }
      const items = ev.items ? JSON.parse(JSON.stringify(ev.items)) : []; setEventItems(items); setHasItems(items.length>0);
      const passives = ev.passives ? JSON.parse(JSON.stringify(ev.passives)) : []; setEventPassives(passives); setHasPassives(passives.length>0);
      setCreateMode(true);
  };

  const handleDeleteEvent = async (id: string) => { Alert.alert("Apagar", "Tem certeza?", [{text:"Cancelar"},{text:"Apagar", onPress:async()=>{await supabase.from('game_events').delete().eq('id',id); fetchEvents();}}]); };

  const handleSaveEvent = async () => {
      if(!newEventTitle) return Alert.alert("Erro", "Título obrigatório");
      const currentIsFaction = isFactionEvent;
      if (currentIsFaction && eventFactions.length < 2) return Alert.alert('Erro', 'Min 2 Facções');
      setSaving(true);
      try {
          let finalImageUrl = newEventImage;
          if (pickedEventImageUri) { const url = await uploadToSupabase(pickedEventImageUri); if (url) finalImageUrl = url; }
          const payload = {
              title: newEventTitle, description: newEventDesc, image_url: finalImageUrl || null,
              is_faction_event: currentIsFaction, has_three_units_boss_rule: hasThreeUnitsRule,
              event_characters: currentIsFaction ? [] : eventCharacters,
              factions: currentIsFaction ? eventFactions : [],
              items: hasItems ? eventItems : [], passives: hasPassives ? eventPassives : []
          };
          if(editingEventId) await supabase.from('game_events').update(payload).eq('id', editingEventId);
          else await supabase.from('game_events').insert(payload);
          setCreateMode(false); await fetchEvents(); Alert.alert("Sucesso", "Evento Salvo!");
      } catch (e: any) { Alert.alert("Erro", e.message); } finally { setSaving(false); }
  };

  // --- SUB LOGIC (CHARACTERS) ---
  const openAddEventChar = () => { setEvCharName(''); setEvCharHp('10'); setEvCharHasLife(true); setEvCharIsBoss(false); setEvCharBecomesBoss(false); setEvCharStartsOnBoard(false); setEvCharSkills([]); setEditingEventCharIndex(null); setEditingEvCharSkillIndex(null); clearSkillForm(); setCreateEventCharModalVisible(true); };
  const openEditEventChar = (index: number) => { const c = eventCharacters[index]; setEvCharName(c.name); setEvCharHp(String(c.base_hp)); setEvCharHasLife(c.has_life); setEvCharIsBoss(c.is_boss); setEvCharBecomesBoss(!!c.becomes_boss_on_condition); setEvCharStartsOnBoard(c.starts_on_board ?? false); setEvCharSkills(c.skills||[]); setEditingEventCharIndex(index); setEditingEvCharSkillIndex(null); clearSkillForm(); setCreateEventCharModalVisible(true); };
  
  const clearSkillForm = () => { 
      setSkillName(''); setSkillDesc(''); setSkillCost(''); setSkillDuration(''); 
      setSkillType('active'); setSkillCombatState('normal'); 
      setSkillCondition('normal'); 
      setPassiveTarget('self'); 
  };
  
  const addEvCharSkill = () => {
      if(!skillName) return Alert.alert("Ops", "Nome skill?");
      
      let pt: any = 'individual';
      let at: any = 'individual';

      // 1. LÓGICA DE PASSIVA (Combinação de Target + Condition)
      if (skillType === 'passive') {
          if (passiveTarget === 'global') {
              // Debuff em todos
              pt = (skillCondition === 'transformed') ? 'general_transformed' : 'general';
          } else {
              // Buff em si mesmo
              pt = (skillCondition === 'transformed') ? 'transformed' : 'individual';
          }
      } 
      // 2. LÓGICA DE ATIVA
      else if (skillType === 'active') {
          if (skillCondition === 'transformed') at = 'transformed';
      }
      
      const ns: CharacterSkill = {
          id: editingEvCharSkillIndex!==null ? evCharSkills[editingEvCharSkillIndex].id : Math.random().toString(), 
          name: skillName, description: skillDesc, cost: skillCost, type: skillType, 
          duration: parseInt(skillDuration)||0, combat_state: evCharIsBoss ? skillCombatState : 'normal', 
          passive_type: pt, active_type: at
      };

      if(editingEvCharSkillIndex!==null){ const u=[...evCharSkills]; u[editingEvCharSkillIndex]=ns; setEvCharSkills(u); }
      else { setEvCharSkills([...evCharSkills,ns]); }
      setEditingEvCharSkillIndex(null); clearSkillForm();
  };

  const handleEditEvCharSkill = (i:number) => {
      const s = evCharSkills[i]; setSkillName(s.name); setSkillDesc(s.description); setSkillCost(s.cost||''); setSkillDuration(String(s.duration||'')); 
      
      // Mapear tipos antigos ou custom para os 3 principais
      if (s.type === 'summon') setSkillType('active'); // Fallback se houver legado
      else setSkillType(s.type as any);

      setSkillCombatState(s.combat_state||'normal');
      
      // Recuperar Condição (Transformado vs Normal)
      if((s.type==='passive' && (s.passive_type==='transformed'||s.passive_type==='general_transformed')) || (s.type==='active' && s.active_type==='transformed')) 
          setSkillCondition('transformed'); 
      else setSkillCondition('normal');

      // Recuperar Alvo da Passiva
      if (s.type === 'passive') { 
          if (s.passive_type === 'general' || s.passive_type === 'general_transformed') setPassiveTarget('global'); 
          else setPassiveTarget('self'); 
      }

      setEditingEvCharSkillIndex(i);
  };

  const saveEventChar = () => { if(!evCharName) return Alert.alert("Ops","Nome?"); const cd:EventCharacter={name:evCharName, base_hp:evCharHasLife?(parseInt(evCharHp)||0):0, has_life:evCharHasLife, is_boss:evCharIsBoss, becomes_boss_on_condition:evCharBecomesBoss, starts_on_board:evCharStartsOnBoard, skills:evCharSkills}; if(editingEventCharIndex!==null){const u=[...eventCharacters];u[editingEventCharIndex]=cd;setEventCharacters(u);}else{setEventCharacters([...eventCharacters,cd]);} setCreateEventCharModalVisible(false); };

  // Helpers
  const handleGenerateFactions=()=>{const c=parseInt(factionCountInput); if(isNaN(c)||c<2)return Alert.alert("Erro","Min 2"); const n=[]; for(let i=0;i<c;i++) n.push(eventFactions[i]||{id:`temp_${Date.now()}_${i}`,name:`Facção ${i+1}`,skills:[]}); setEventFactions(n);};
  const openEditFaction=(f:any)=>{setCurrentEditingFactionId(f.id);setCurrentFactionName(f.name);setCurrentFactionSkills(f.skills||[]);setEditFactionModalVisible(true);};
  const saveCurrentFaction=()=>{setEventFactions(p=>p.map(f=>f.id===currentEditingFactionId?{...f,name:currentFactionName,skills:currentFactionSkills}:f));setEditFactionModalVisible(false);};
  const handleAddFactionSkill=()=>{const ns:CharacterSkill={id:Date.now().toString(),name:factionSkillName,description:factionSkillDesc,type:'passive',passive_type:'individual',duration:-1}; setCurrentFactionSkills([...currentFactionSkills,{round:parseInt(factionSkillRoundInput)||1,skill:ns}].sort((a,b)=>a.round-b.round)); setFactionSkillName('');setFactionSkillDesc('');setSelectFactionSkillModalVisible(false);};
  const openAddItem=()=>{setItemName('');setItemDesc('');setItemDamage('');setItemHasAmmo(false);setItemAmmoCount('');setEditingItemIndex(null);setCreateItemModalVisible(true);};
  const openEditItem=(i:number)=>{const x=eventItems[i];setItemName(x.name);setItemDesc(x.description);setItemDamage(x.damage);setItemHasAmmo(x.has_ammo);setItemAmmoCount(x.ammo_count?String(x.ammo_count):'');setEditingItemIndex(i);setCreateItemModalVisible(true);};
  const saveItem=()=>{const ni:EventItem={id:editingItemIndex!==null?eventItems[editingItemIndex].id:Date.now().toString(),name:itemName,description:itemDesc,damage:itemDamage,has_ammo:itemHasAmmo,ammo_count:itemHasAmmo?parseInt(itemAmmoCount)||0:0}; if(editingItemIndex!==null){const u=[...eventItems];u[editingItemIndex]=ni;setEventItems(u);}else{setEventItems([...eventItems,ni]);} setCreateItemModalVisible(false);};
  const openAddPassive=()=>{setPassiveName('');setPassiveDesc('');setEditingPassiveIndex(null);setCreatePassiveModalVisible(true);};
  const openEditPassive=(i:number)=>{const p=eventPassives[i];setPassiveName(p.name);setPassiveDesc(p.description);setEditingPassiveIndex(i);setCreatePassiveModalVisible(true);};
  const savePassive=()=>{const np:CharacterSkill={id:editingPassiveIndex!==null?eventPassives[editingPassiveIndex].id:Date.now().toString(),name:passiveName,description:passiveDesc,type:'passive',passive_type:'general',duration:-1}; if(editingPassiveIndex!==null){const u=[...eventPassives];u[editingPassiveIndex]=np;setEventPassives(u);}else{setEventPassives([...eventPassives,np]);} setCreatePassiveModalVisible(false);};

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, createMode ? { height: '90%' } : { maxHeight: '90%' }]}>
            {!createMode ? (
                // LISTA
                <>
                    <View style={styles.header}><Text style={styles.title}>Gerenciar Eventos</Text><View style={{flexDirection:'row'}}><TouchableOpacity onPress={openCreateEvent} style={{marginRight:15}}><Ionicons name="add-circle" size={28} color="#00B37E"/></TouchableOpacity><TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color="#ccc"/></TouchableOpacity></View></View>
                    {loading ? <ActivityIndicator color="#8257e5" /> : <FlatList data={events} keyExtractor={i=>i.id} renderItem={({item})=><View style={styles.itemRow}><View style={{flex:1}}><Text style={{color:'#fff',fontWeight:'bold'}}>{item.title}</Text><Text style={{color:'#777',fontSize:10}}>{item.is_faction_event?'FACÇÃO':'BOSS'}</Text></View><TouchableOpacity onPress={()=>openEditEvent(item)} style={{marginRight:15}}><Ionicons name="pencil" size={20} color="#8257e5"/></TouchableOpacity><TouchableOpacity onPress={()=>handleDeleteEvent(item.id)}><Ionicons name="trash" size={20} color="#ff4444"/></TouchableOpacity></View>}/>}
                </>
            ) : (
                // FORMULÁRIO
                <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{flex:1}}>
                    <ScrollView contentContainerStyle={{paddingBottom:20}}>
                        <View style={styles.header}><Text style={styles.title}>{editingEventId?"Editar":"Criar"}</Text></View>
                        <TouchableOpacity onPress={pickEventImage} style={styles.imagePickerBtn}>{pickedEventImageUri?<Image source={{uri:pickedEventImageUri}} style={styles.imagePreview}/>:newEventImage?<Image source={{uri:newEventImage}} style={styles.imagePreview}/>:<View style={{alignItems:'center'}}><Ionicons name="image" size={30} color="#777"/><Text style={{color:'#777'}}>Capa</Text></View>}</TouchableOpacity>
                        <TextInput style={styles.input} placeholder="Título" value={newEventTitle} onChangeText={setNewEventTitle} placeholderTextColor="#555"/>
                        <TextInput style={[styles.input,{height:80}]} placeholder="Descrição" value={newEventDesc} onChangeText={setNewEventDesc} multiline placeholderTextColor="#555"/>
                        <View style={styles.checkboxContainer}><Text style={styles.checkboxLabel}>É Facção?</Text><Switch value={isFactionEvent} onValueChange={v=>{setIsFactionEvent(v); if(v)setEventCharacters([]); else setEventFactions([]);}} trackColor={{false:'#333',true:'#FFD700'}}/></View>
                        {!isFactionEvent && <View style={[styles.checkboxContainer,{borderColor:'#ff8800'}]}><Text style={styles.checkboxLabel}>Regra 3 Inimigos = 1 Boss?</Text><Switch value={hasThreeUnitsRule} onValueChange={setHasThreeUnitsRule} trackColor={{false:'#333',true:'#ff8800'}}/></View>}

                        {isFactionEvent ? (
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionTitle,{color:'#FFD700'}]}>FACÇÕES</Text>
                                <View style={{flexDirection:'row',alignItems:'center',marginBottom:15}}><TextInput style={[styles.input,{flex:1,marginBottom:0,marginRight:10}]} value={factionCountInput} onChangeText={setFactionCountInput} keyboardType="numeric"/><TouchableOpacity style={styles.actionBtn} onPress={handleGenerateFactions}><Text style={{color:'#000',fontWeight:'bold'}}>GERAR</Text></TouchableOpacity></View>
                                {eventFactions.map((f,i)=><TouchableOpacity key={i} style={styles.listItem} onPress={()=>openEditFaction(f)}><Text style={{color:'#fff'}}>{f.name}</Text><Ionicons name="pencil" color="#FFD700" size={18}/></TouchableOpacity>)}
                            </View>
                        ) : (
                            <View style={styles.sectionContainer}>
                                <Text style={[styles.sectionTitle,{color:'#00B37E'}]}>INIMIGOS (BESTIÁRIO)</Text>
                                {eventCharacters.map((c,i)=><View key={i} style={[styles.listItem,{borderLeftWidth:4,borderLeftColor:c.is_boss?'#ff4444':'#00B37E'}]}><View><Text style={{color:'#fff',fontWeight:'bold'}}>{c.name}</Text><Text style={{color:'#aaa',fontSize:10}}>{c.base_hp} HP</Text></View><View style={{flexDirection:'row'}}><TouchableOpacity onPress={()=>openEditEventChar(i)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#FFD700"/></TouchableOpacity><TouchableOpacity onPress={()=>{const u=[...eventCharacters];u.splice(i,1);setEventCharacters(u)}}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity></View></View>)}
                                <TouchableOpacity onPress={openAddEventChar} style={[styles.dashedBtn,{borderColor:'#00B37E'}]}><Text style={{color:'#00B37E'}}>+ Personagem</Text></TouchableOpacity>
                            </View>
                        )}

                        <View style={[styles.checkboxContainer,{marginTop:15,borderColor:'#44aaff'}]}><Text style={styles.checkboxLabel}>Loot / Itens?</Text><Switch value={hasItems} onValueChange={setHasItems} trackColor={{false:'#333',true:'#44aaff'}}/></View>
                        {hasItems && <View style={styles.sectionContainer}><Text style={[styles.sectionTitle,{color:'#44aaff'}]}>ITENS</Text>{eventItems.map((item,i)=><View key={i} style={styles.listItem}><Text style={{color:'#fff',flex:1}}>{item.name}</Text><View style={{flexDirection:'row'}}><TouchableOpacity onPress={()=>openEditItem(i)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#44aaff"/></TouchableOpacity><TouchableOpacity onPress={()=>{const u=[...eventItems];u.splice(i,1);setEventItems(u)}}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity></View></View>)}<TouchableOpacity onPress={openAddItem} style={[styles.dashedBtn,{borderColor:'#44aaff'}]}><Text style={{color:'#44aaff'}}>+ Item</Text></TouchableOpacity></View>}

                        <View style={[styles.checkboxContainer,{marginTop:15,borderColor:'#9b59b6'}]}><Text style={styles.checkboxLabel}>Regras Globais?</Text><Switch value={hasPassives} onValueChange={setHasPassives} trackColor={{false:'#333',true:'#9b59b6'}}/></View>
                        {hasPassives && <View style={styles.sectionContainer}><Text style={[styles.sectionTitle,{color:'#9b59b6'}]}>REGRAS</Text>{eventPassives.map((p,i)=><View key={i} style={styles.listItem}><Text style={{color:'#fff',flex:1}}>{p.name}</Text><View style={{flexDirection:'row'}}><TouchableOpacity onPress={()=>openEditPassive(i)} style={{marginRight:10}}><Ionicons name="pencil" size={18} color="#9b59b6"/></TouchableOpacity><TouchableOpacity onPress={()=>{const u=[...eventPassives];u.splice(i,1);setEventPassives(u)}}><Ionicons name="trash" size={18} color="#ff4444"/></TouchableOpacity></View></View>)}<TouchableOpacity onPress={openAddPassive} style={[styles.dashedBtn,{borderColor:'#9b59b6'}]}><Text style={{color:'#9b59b6'}}>+ Regra</Text></TouchableOpacity></View>}

                        <TouchableOpacity onPress={handleSaveEvent} style={[styles.saveBtn,{marginTop:20}]} disabled={saving}><Text style={styles.btnText}>SALVAR EVENTO</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setCreateMode(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
                    </ScrollView>
                </KeyboardAvoidingView>
            )}

            {/* MODAL INIMIGO */}
            <Modal transparent visible={createEventCharModalVisible} animationType="fade"><View style={styles.modalOverlay}><View style={[styles.modalContent,{height:'auto',maxHeight:'90%'}]}><ScrollView>
                <Text style={styles.modalTitle}>Inimigo / Vilão</Text>
                <TextInput style={styles.input} placeholder="Nome" value={evCharName} onChangeText={setEvCharName} placeholderTextColor="#555"/>
                <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}><View style={{flexDirection:'row',alignItems:'center'}}><Text style={{color:'#fff',marginRight:5}}>Vida?</Text><Switch value={evCharHasLife} onValueChange={setEvCharHasLife}/></View><View style={{flexDirection:'row',alignItems:'center'}}><Text style={{color:'#fff',marginRight:5}}>É Boss?</Text><Switch value={evCharIsBoss} onValueChange={setEvCharIsBoss}/></View></View>
                {evCharHasLife && <TextInput style={styles.input} placeholder="HP" value={evCharHp} onChangeText={setEvCharHp} keyboardType="numeric"/>}
                
                {/* SKILL FORM ATUALIZADO */}
                <View style={styles.skillForm}>
                    <Text style={{color:'#aaa', marginBottom:5, fontWeight:'bold'}}>Adicionar Habilidade</Text>
                    <TextInput style={[styles.input,{marginBottom:5}]} placeholder="Nome Skill" value={skillName} onChangeText={setSkillName} placeholderTextColor="#555"/>
                    <TextInput style={[styles.input,{marginBottom:5}]} placeholder="Descrição" value={skillDesc} onChangeText={setSkillDesc} placeholderTextColor="#555"/>
                    
                    {/* TIPO DE SKILL (SEM INVOCAR, COM TRANSFORMAÇÃO) */}
                    <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-around',marginBottom:10}}>
                        <TouchableOpacity onPress={()=>setSkillType('active')}><Text style={{color:skillType==='active'?'#00B37E':'#555',fontWeight:'bold',margin:5}}>Ativa</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setSkillType('passive')}><Text style={{color:skillType==='passive'?'#8257e5':'#555',fontWeight:'bold',margin:5}}>Passiva</Text></TouchableOpacity>
                        <TouchableOpacity onPress={()=>setSkillType('transformation')}><Text style={{color:skillType==='transformation'?'#FFD700':'#555',fontWeight:'bold',margin:5}}>Transf.</Text></TouchableOpacity>
                    </View>
                    
                    {/* SELETORES ESPECÍFICOS */}
                    
                    {/* 1. SE PASSIVA: ESCOLHE ALVO (Buff/Debuff) E CONDIÇÃO (Normal/Transf) */}
                    {skillType === 'passive' && (
                        <View style={{marginBottom:10, padding:10, backgroundColor:'#121214', borderRadius:8}}>
                            <View style={{marginBottom:10}}>
                                <Text style={{color:'#fff',fontSize:12,marginBottom:5,textAlign:'center'}}>Efeito:</Text>
                                <View style={{flexDirection:'row', justifyContent:'center'}}>
                                    <TouchableOpacity onPress={()=>setPassiveTarget('self')} style={{padding:8, backgroundColor:passiveTarget==='self'?'#00B37E':'#333', borderRadius:4, marginRight:10}}><Text style={{color:'#fff',fontSize:10,fontWeight:'bold'}}>BUFF (Si Mesmo)</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>setPassiveTarget('global')} style={{padding:8, backgroundColor:passiveTarget==='global'?'#ff4444':'#333', borderRadius:4}}><Text style={{color:'#fff',fontSize:10,fontWeight:'bold'}}>DEBUFF (Todos)</Text></TouchableOpacity>
                                </View>
                            </View>
                            
                            <View>
                                <Text style={{color:'#fff',fontSize:12,marginBottom:5,textAlign:'center'}}>Ativa quando?</Text>
                                <View style={{flexDirection:'row', justifyContent:'center'}}>
                                    <TouchableOpacity onPress={()=>setSkillCondition('normal')} style={{padding:8, backgroundColor:skillCondition==='normal'?'#777':'#333', borderRadius:4, marginRight:10}}><Text style={{color:'#fff',fontSize:10}}>Sempre / Normal</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={()=>setSkillCondition('transformed')} style={{padding:8, backgroundColor:skillCondition==='transformed'?'#FFD700':'#333', borderRadius:4}}><Text style={{color:skillCondition==='transformed'?'#000':'#fff',fontSize:10}}>Só Transformado</Text></TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* 2. SE TRANSFORMAÇÃO: DURAÇÃO */}
                    {skillType === 'transformation' && (
                        <View style={{marginBottom:10}}>
                            <TextInput style={[styles.input,{marginBottom:0}]} placeholder="Duração (Turnos)" value={skillDuration} onChangeText={setSkillDuration} keyboardType="numeric"/>
                        </View>
                    )}

                    {/* 3. SE ATIVA: CUSTO */}
                    {skillType === 'active' && (
                        <View style={{flexDirection:'row'}}>
                            <TextInput style={[styles.input,{flex:1,marginRight:5}]} placeholder="Custo" value={skillCost} onChangeText={setSkillCost}/>
                        </View>
                    )}
                    
                    <TouchableOpacity onPress={addEvCharSkill} style={[styles.saveBtn,{padding:10}]}><Text style={{color:'#fff',fontSize:12}}>+ ADICIONAR SKILL</Text></TouchableOpacity>
                </View>

                {evCharSkills.map((s,i)=>(
                    <View key={i} style={styles.skillRow}>
                        <View style={{flex:1}}>
                            <Text style={{color:'#fff',fontWeight:'bold'}}>
                                {s.name} 
                                {(s.passive_type==='general'||s.passive_type==='general_transformed')&&<Text style={{color:'#ff4444',fontSize:10}}> [GLOBAL]</Text>}
                                {s.type==='transformation'&&<Text style={{color:'#FFD700',fontSize:10}}> [FORMA]</Text>}
                                {(s.passive_type==='transformed'||s.passive_type==='general_transformed')&&<Text style={{color:'#FFD700',fontSize:10}}> (Transf.)</Text>}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={()=>{const u=[...evCharSkills];u.splice(i,1);setEvCharSkills(u)}}><Ionicons name="trash" size={16} color="red"/></TouchableOpacity>
                    </View>
                ))}
                
                <TouchableOpacity onPress={saveEventChar} style={[styles.saveBtn,{marginTop:10}]}><Text style={styles.btnText}>SALVAR VILÃO</Text></TouchableOpacity>
                <TouchableOpacity onPress={()=>setCreateEventCharModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity>
            </ScrollView></View></View></Modal>

            {/* Outros Modais (Facção/Item) */}
            <Modal transparent visible={editFactionModalVisible} animationType="fade"><View style={styles.modalOverlay}><View style={[styles.modalContent, {height:'auto', maxHeight:'90%'}]}><Text style={styles.modalTitle}>Editar Facção</Text><TextInput style={styles.input} value={currentFactionName} onChangeText={setCurrentFactionName}/><FlatList data={currentFactionSkills} keyExtractor={(i,x)=>`${x}`} renderItem={({item,index})=>(<View style={styles.skillRow}><Text style={{color:'#fff',flex:1}}>R{item.round}: {item.skill.name}</Text><TouchableOpacity onPress={()=>{const u=[...currentFactionSkills];u.splice(index,1);setCurrentFactionSkills(u)}}><Ionicons name="trash" size={16} color="red"/></TouchableOpacity></View>)}/><TouchableOpacity style={[styles.dashedBtn,{marginTop:10}]} onPress={()=>setSelectFactionSkillModalVisible(true)}><Text style={{color:'#00B37E'}}>+ Add Skill</Text></TouchableOpacity><TouchableOpacity onPress={saveCurrentFaction} style={[styles.saveBtn,{marginTop:10}]}><Text style={styles.btnText}>SALVAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setEditFactionModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity></View></View></Modal>
            <Modal transparent visible={selectFactionSkillModalVisible} animationType="fade"><View style={styles.modalOverlay}><View style={[styles.modalContent, {height:'auto'}]}><Text style={styles.modalTitle}>Nova Skill</Text><TextInput style={styles.input} placeholder="Volta" value={factionSkillRoundInput} onChangeText={setFactionSkillRoundInput} keyboardType="numeric"/><TextInput style={styles.input} placeholder="Nome" value={factionSkillName} onChangeText={setFactionSkillName} placeholderTextColor="#555"/><TextInput style={styles.input} placeholder="Desc" value={factionSkillDesc} onChangeText={setFactionSkillDesc} placeholderTextColor="#555"/><TouchableOpacity onPress={handleAddFactionSkill} style={styles.saveBtn}><Text style={styles.btnText}>ADICIONAR</Text></TouchableOpacity><TouchableOpacity onPress={()=>setSelectFactionSkillModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity></View></View></Modal>
            <Modal transparent visible={createItemModalVisible} animationType="fade"><View style={styles.modalOverlay}><View style={[styles.modalContent, {height:'auto'}]}><Text style={styles.modalTitle}>Novo Item</Text><TextInput style={styles.input} placeholder="Nome" value={itemName} onChangeText={setItemName} placeholderTextColor="#555"/><TextInput style={styles.input} placeholder="Dano" value={itemDamage} onChangeText={setItemDamage} placeholderTextColor="#555"/><TextInput style={[styles.input, {height:60}]} placeholder="Desc" value={itemDesc} onChangeText={setItemDesc} multiline placeholderTextColor="#555"/><View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:15, backgroundColor:'#222', padding:10, borderRadius:8}}><Text style={{color:'#fff'}}>Munição?</Text><Switch value={itemHasAmmo} onValueChange={setItemHasAmmo} trackColor={{false:'#333', true:'#44aaff'}}/></View>{itemHasAmmo && <TextInput style={[styles.input, {borderColor:'#44aaff'}]} placeholder="Qtd" value={itemAmmoCount} onChangeText={setItemAmmoCount} keyboardType="numeric" placeholderTextColor="#555"/>}<TouchableOpacity onPress={saveItem} style={[styles.saveBtn, {backgroundColor: '#44aaff'}]}><Text style={styles.btnText}>SALVAR ITEM</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreateItemModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity></View></View></Modal>
            <Modal transparent visible={createPassiveModalVisible} animationType="fade"><View style={styles.modalOverlay}><View style={[styles.modalContent, {height:'auto'}]}><Text style={styles.modalTitle}>Nova Regra</Text><TextInput style={styles.input} placeholder="Nome" value={passiveName} onChangeText={setPassiveName} placeholderTextColor="#555"/><TextInput style={[styles.input, {height:80}]} placeholder="Desc" value={passiveDesc} onChangeText={setPassiveDesc} multiline placeholderTextColor="#555"/><TouchableOpacity onPress={savePassive} style={[styles.saveBtn, {backgroundColor: '#9b59b6'}]}><Text style={styles.btnText}>SALVAR REGRA</Text></TouchableOpacity><TouchableOpacity onPress={()=>setCreatePassiveModalVisible(false)} style={styles.cancelBtn}><Text style={styles.btnText}>CANCELAR</Text></TouchableOpacity></View></View></Modal>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 24, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, alignItems:'center' },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign:'center', marginBottom:15 },
  itemRow: { flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderColor: '#333', alignItems:'center' },
  input: { backgroundColor: '#27272A', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 15, borderWidth:1, borderColor:'#3F3F46' },
  saveBtn: { backgroundColor: '#00875F', padding: 15, borderRadius: 8, alignItems: 'center' },
  cancelBtn: { backgroundColor: '#333', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  actionBtn: { backgroundColor:'#00B37E', padding:10, borderRadius:8, alignItems:'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  imagePickerBtn: { width:'100%', height:120, backgroundColor:'#222', borderRadius:8, alignItems:'center', justifyContent:'center', borderStyle:'dashed', borderWidth:1, borderColor:'#555', marginBottom:20 },
  imagePreview: { width:'100%', height:'100%', borderRadius:8, resizeMode:'cover' },
  sectionContainer: { marginTop:10, borderTopWidth:1, borderTopColor:'#333', paddingTop:10 },
  sectionTitle: { fontSize:14, fontWeight:'bold', marginBottom:10 },
  listItem: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', backgroundColor:'#121214', padding:10, borderRadius:8, marginBottom:5, borderWidth:1, borderColor:'#333' },
  dashedBtn: { alignItems:'center', padding:10, borderStyle:'dashed', borderWidth:1, borderColor:'#555', borderRadius:8, marginTop:5 },
  skillForm: { backgroundColor:'#202024', padding:10, borderRadius:8 },
  skillRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:8, borderBottomWidth:1, borderBottomColor:'#333' },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#222', padding: 15, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#555' },
  checkboxLabel: { color: '#fff', fontWeight: 'bold' }
});