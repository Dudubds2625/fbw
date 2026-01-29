import React, { useState } from 'react';
import { 
    View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, 
    TextInput, Alert, Modal, FlatList, KeyboardAvoidingView, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GameEvent, BossSkill, RoomParticipant, GameCharacter } from '../types/rpg';

export interface EventMinion {
    id: string;
    original_id: string;
    name: string;
    current_hp: number;
    max_hp: number;
    image_url?: string;
}

export interface EventState {
    current_hp: number;
    max_hp: number;
    name: string;
    image_url?: string;
    boss_skills?: BossSkill[];
    minions?: EventMinion[];
}

interface EventPanelProps {
    gameEvent: GameEvent | null;
    eventState: EventState | null;
    participants: RoomParticipant[];
    allCharacters: GameCharacter[];
    onUpdateEventState: (newState: EventState) => void;
    onBossAttack: (targetId: string, damage: number) => void;
    onGoBack: () => void;
}

export default function EventPanel({ 
    gameEvent, 
    eventState, 
    participants, 
    allCharacters,
    onUpdateEventState, 
    onBossAttack,
    onGoBack 
}: EventPanelProps) {
    
    const [bossAttackDamage, setBossAttackDamage] = useState('10');
    const [bossTargetId, setBossTargetId] = useState<string | null>(null);
    const [summonModalVisible, setSummonModalVisible] = useState(false);

    // --- NOVOS STATES PARA EDIÇÃO ---
    const [editMinionModalVisible, setEditMinionModalVisible] = useState(false);
    const [editingMinionIndex, setEditingMinionIndex] = useState<number | null>(null);
    const [editMinionName, setEditMinionName] = useState('');
    const [editMinionCurHp, setEditMinionCurHp] = useState('');
    const [editMinionMaxHp, setEditMinionMaxHp] = useState('');

    // Fallbacks de Dados
    const displayTitle = eventState?.name || gameEvent?.title || "Evento";
    const displayImage = eventState?.image_url || gameEvent?.image_url;
    
    const skills = (eventState?.boss_skills && eventState.boss_skills.length > 0)
        ? eventState.boss_skills 
        : (gameEvent?.boss_skills || []);

    const minions = eventState?.minions || [];

    const handleAttack = () => {
        if (!bossTargetId) return Alert.alert("Ops", "Selecione um alvo.");
        const dmg = parseInt(bossAttackDamage);
        if (isNaN(dmg) || dmg <= 0) return Alert.alert("Ops", "Dano inválido.");
        onBossAttack(bossTargetId, dmg);
    };

    const changeBossHp = (amount: number) => {
        if (!eventState) return;
        const newHp = Math.max(0, Math.min(eventState.max_hp, eventState.current_hp + amount));
        onUpdateEventState({ ...eventState, current_hp: newHp });
    };

    const handleSummonMinion = (char: GameCharacter) => {
        if (!eventState) return;
        const newMinion: EventMinion = {
            id: Date.now().toString(),
            original_id: char.id,
            name: char.name,
            current_hp: char.base_hp || 10,
            max_hp: char.base_hp || 10,
            image_url: char.image_url
        };
        const currentMinions = eventState.minions || [];
        onUpdateEventState({ 
            ...eventState, 
            minions: [...currentMinions, newMinion] 
        });
        setSummonModalVisible(false);
    };

    // --- FUNÇÕES DE EDIÇÃO DO MINION ---
    const openEditMinion = (index: number) => {
        const m = eventState?.minions?.[index];
        if (!m) return;
        setEditingMinionIndex(index);
        setEditMinionName(m.name);
        setEditMinionCurHp(String(m.current_hp));
        setEditMinionMaxHp(String(m.max_hp));
        setEditMinionModalVisible(true);
    };

    const saveMinionEdit = () => {
        if (editingMinionIndex === null || !eventState?.minions) return;
        
        const newMinions = [...eventState.minions];
        const updatedMinion = { ...newMinions[editingMinionIndex] };

        const newCur = parseInt(editMinionCurHp);
        const newMax = parseInt(editMinionMaxHp);

        if (!editMinionName) return Alert.alert("Erro", "Nome obrigatório");
        if (isNaN(newCur) || isNaN(newMax)) return Alert.alert("Erro", "HP deve ser numérico");

        updatedMinion.name = editMinionName;
        updatedMinion.current_hp = Math.max(0, newCur);
        updatedMinion.max_hp = Math.max(1, newMax);

        // Garante que o HP atual não passe do máximo (opcional, mas recomendado)
        if (updatedMinion.current_hp > updatedMinion.max_hp) {
            updatedMinion.current_hp = updatedMinion.max_hp;
        }

        newMinions[editingMinionIndex] = updatedMinion;
        onUpdateEventState({ ...eventState, minions: newMinions });
        setEditMinionModalVisible(false);
    };

    const changeMinionHp = (minionIndex: number, amount: number) => {
        if (!eventState || !eventState.minions) return;
        const newMinions = [...eventState.minions];
        const minion = { ...newMinions[minionIndex] };
        const newHp = Math.max(0, Math.min(minion.max_hp, minion.current_hp + amount));
        
        if (newHp === 0) {
            Alert.alert("Baixa", `${minion.name} derrotado. Remover?`, [
                { text: "Não (0 HP)", onPress: () => { minion.current_hp = 0; newMinions[minionIndex] = minion; onUpdateEventState({ ...eventState, minions: newMinions }); }},
                { text: "Sim", onPress: () => { newMinions.splice(minionIndex, 1); onUpdateEventState({ ...eventState, minions: newMinions }); }}
            ]);
        } else {
            minion.current_hp = newHp;
            newMinions[minionIndex] = minion;
            onUpdateEventState({ ...eventState, minions: newMinions });
        }
    };

    if (!eventState && !gameEvent) return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onGoBack}><Ionicons name="arrow-back" size={24} color="#ccc" /></TouchableOpacity>
                <Text style={styles.title}>Evento</Text>
            </View>
            <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                <Text style={styles.emptyText}>Nenhum evento ativo.</Text>
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onGoBack} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#ccc" />
                    <Text style={{color:'#ccc', marginLeft:5}}>Mesa</Text>
                </TouchableOpacity>
                <Text style={styles.title}>{displayTitle}</Text>
                <View style={{width: 60}} /> 
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                {displayImage && <Image source={{ uri: displayImage }} style={styles.image} resizeMode='cover' />}

                {/* BOSS CARD */}
                {eventState ? (
                    <View style={styles.bossCard}>
                        <Text style={styles.bossName}>{eventState.name.toUpperCase()}</Text>
                        <View style={styles.hpRow}>
                             <TouchableOpacity onPress={() => changeBossHp(-10)} style={[styles.miniBtn, {backgroundColor:'#330000'}]}><Text style={{color:'#ff4444'}}>-10</Text></TouchableOpacity>
                             <TouchableOpacity onPress={() => changeBossHp(-1)} style={[styles.miniBtn, {backgroundColor:'#ff4444'}]}><Ionicons name="remove" size={20} color="#fff"/></TouchableOpacity>
                             <View style={{alignItems:'center', minWidth: 60}}>
                                 <Text style={styles.hpValue}>{eventState.current_hp}</Text>
                                 <Text style={{color:'#777', fontSize:10}}>de {eventState.max_hp}</Text>
                             </View>
                             <TouchableOpacity onPress={() => changeBossHp(1)} style={[styles.miniBtn, {backgroundColor:'#00B37E'}]}><Ionicons name="add" size={20} color="#fff"/></TouchableOpacity>
                             <TouchableOpacity onPress={() => changeBossHp(10)} style={[styles.miniBtn, {backgroundColor:'#003300'}]}><Text style={{color:'#00B37E'}}>+10</Text></TouchableOpacity>
                        </View>
                        <View style={styles.hpBarBg}><View style={[styles.hpBarFill, {width: `${Math.min(100, Math.max(0, (eventState.current_hp/eventState.max_hp)*100))}%`}]} /></View>

                        <View style={styles.attackSection}>
                            <Text style={styles.sectionLabel}>ATACAR JOGADOR:</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:10}}>
                                {participants.map(p => (
                                    <TouchableOpacity key={p.id} onPress={() => setBossTargetId(p.id)} style={[styles.targetChip, bossTargetId === p.id && {backgroundColor:'#ff4444', borderColor:'#ff4444'}]}>
                                        <Text style={{color:'#fff', fontSize:12, fontWeight: bossTargetId === p.id ? 'bold' : 'normal'}}>{p.username}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                            <View style={{flexDirection:'row', alignItems:'center'}}>
                                <TextInput style={styles.input} value={bossAttackDamage} onChangeText={setBossAttackDamage} keyboardType='numeric' placeholder="Dano" placeholderTextColor="#777" />
                                <TouchableOpacity style={styles.attackBtn} onPress={handleAttack}><Text style={{color:'#fff', fontWeight:'bold', fontSize:12}}>ATACAR</Text></TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ) : <Text style={styles.emptyText}>Carregando Boss...</Text>}

                {/* MINIONS */}
                {eventState && (
                    <View style={{marginTop: 20}}>
                        <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
                            <Text style={styles.sectionLabel}>ALIADOS ({minions.length})</Text>
                            <TouchableOpacity onPress={() => setSummonModalVisible(true)} style={styles.summonBtn}><Ionicons name="person-add" size={16} color="#000" /><Text style={styles.summonBtnText}> INVOCAR</Text></TouchableOpacity>
                        </View>
                        {minions.map((minion, idx) => (
                            <View key={minion.id} style={styles.minionCard}>
                                <View style={{flexDirection:'row', alignItems:'center', flex:1}}>
                                    {minion.image_url ? <Image source={{ uri: minion.image_url }} style={styles.minionThumb} /> : <View style={[styles.minionThumb, {backgroundColor:'#333'}]} />}
                                    <View>
                                        <Text style={styles.minionName}>{minion.name}</Text>
                                        {/* Botão de Editar Adicionado Aqui */}
                                        <TouchableOpacity onPress={() => openEditMinion(idx)} style={{flexDirection:'row', alignItems:'center', marginTop:2}}>
                                             <Ionicons name="pencil" size={12} color="#FFD700" style={{marginRight:4}}/>
                                             <Text style={{color:'#FFD700', fontSize:10}}>Editar</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <View style={styles.minionControls}>
                                    <TouchableOpacity onPress={() => changeMinionHp(idx, -5)} style={[styles.miniBtn, {width:24, height:24, backgroundColor:'#330000', marginRight:2}]}><Text style={{color:'#ff4444', fontSize:9}}>-5</Text></TouchableOpacity>
                                    <TouchableOpacity onPress={() => changeMinionHp(idx, -1)} style={[styles.miniBtn, {width:24, height:24, backgroundColor:'#ff4444'}]}><Ionicons name="remove" size={12} color="#fff"/></TouchableOpacity>
                                    
                                    {/* Exibição do HP */}
                                    <View style={{alignItems:'center', minWidth: 35}}>
                                        <Text style={styles.minionHp}>{minion.current_hp}</Text>
                                        <Text style={{color:'#555', fontSize:8}}>/{minion.max_hp}</Text>
                                    </View>
                                    
                                    <TouchableOpacity onPress={() => changeMinionHp(idx, 1)} style={[styles.miniBtn, {width:24, height:24, backgroundColor:'#00B37E'}]}><Ionicons name="add" size={12} color="#fff"/></TouchableOpacity>
                                    <TouchableOpacity onPress={() => changeMinionHp(idx, 5)} style={[styles.miniBtn, {width:24, height:24, backgroundColor:'#003300', marginLeft:2}]}><Text style={{color:'#00B37E', fontSize:9}}>+5</Text></TouchableOpacity>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {/* SKILLS */}
                {skills.length > 0 && (
                    <View style={{marginTop:10}}>
                        <Text style={styles.sectionLabel}>HABILIDADES</Text>
                        {skills.map((skill: BossSkill, idx: number) => (
                            <View key={idx} style={styles.skillCard}>
                                <Text style={styles.skillName}>{skill.name}</Text>
                                <Text style={styles.skillDesc}>{skill.description}</Text>
                                <Text style={[styles.skillTarget, {color: skill.target==='self'?'#00B37E':'#ff4444'}]}>
                                    {skill.target === 'self' ? 'Buff Próprio' : 'Afeta Jogadores'}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* MODAL DE INVOCAR (JÁ EXISTENTE) */}
            <Modal visible={summonModalVisible} animationType="slide" transparent={true} onRequestClose={() => setSummonModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>INVOCAR REFORÇO</Text>
                            <TouchableOpacity onPress={() => setSummonModalVisible(false)}><Ionicons name="close" size={24} color="#fff"/></TouchableOpacity>
                        </View>
                        <FlatList 
                            data={allCharacters}
                            keyExtractor={(item) => item.id}
                            renderItem={({item}) => (
                                <TouchableOpacity style={styles.charItem} onPress={() => handleSummonMinion(item)}>
                                    {item.image_url ? <Image source={{ uri: item.image_url }} style={styles.charItemImg} /> : <View style={[styles.charItemImg, {backgroundColor:'#333'}]}/>}
                                    <View>
                                        <Text style={styles.charItemName}>{item.name}</Text>
                                        <Text style={{color:'#777', fontSize:12}}>HP Base: {item.base_hp}</Text>
                                    </View>
                                    <Ionicons name="add-circle" size={24} color="#FFD700" style={{marginLeft:'auto'}}/>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </View>
            </Modal>

            {/* NOVO MODAL DE EDIÇÃO */}
            <Modal visible={editMinionModalVisible} animationType="fade" transparent={true} onRequestClose={() => setEditMinionModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {maxHeight: 'auto'}]}>
                        <Text style={styles.modalTitle}>EDITAR PERSONAGEM</Text>
                        
                        <Text style={styles.label}>Nome:</Text>
                        <TextInput style={styles.inputModal} value={editMinionName} onChangeText={setEditMinionName} placeholder="Nome" placeholderTextColor="#555"/>
                        
                        <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                            <View style={{flex:1, marginRight:5}}>
                                <Text style={styles.label}>HP Atual:</Text>
                                <TextInput style={styles.inputModal} value={editMinionCurHp} onChangeText={setEditMinionCurHp} keyboardType="numeric"/>
                            </View>
                            <View style={{flex:1, marginLeft:5}}>
                                <Text style={styles.label}>HP Máximo:</Text>
                                <TextInput style={styles.inputModal} value={editMinionMaxHp} onChangeText={setEditMinionMaxHp} keyboardType="numeric"/>
                            </View>
                        </View>

                        <View style={{flexDirection:'row', marginTop:15}}>
                            <TouchableOpacity onPress={saveMinionEdit} style={[styles.attackBtn, {flex:1, backgroundColor:'#00B37E', marginRight:5}]}>
                                <Text style={{color:'#fff', fontWeight:'bold', textAlign:'center'}}>SALVAR</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setEditMinionModalVisible(false)} style={[styles.attackBtn, {flex:1, backgroundColor:'#333', marginLeft:5}]}>
                                <Text style={{color:'#fff', fontWeight:'bold', textAlign:'center'}}>CANCELAR</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121214' },
    header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:15, backgroundColor:'#202024', paddingTop: 20 },
    backButton: { flexDirection:'row', alignItems:'center', padding: 5 },
    title: { color:'#FFD700', fontSize: 18, fontWeight:'bold' },
    emptyText: { color:'#777', textAlign:'center', marginTop:20 },
    scrollContent: { padding: 20, paddingBottom: 50 },
    image: { width: '100%', height: 160, borderRadius: 12, marginBottom: 15, borderWidth:1, borderColor:'#333' },
    bossCard: { backgroundColor: '#222', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#ff4444' },
    bossName: { color: '#ff4444', fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
    hpRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    miniBtn: { width: 35, height: 35, borderRadius: 17.5, alignItems: 'center', justifyContent: 'center' },
    hpValue: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
    hpBarBg: { height: 6, backgroundColor: '#444', borderRadius: 3, overflow: 'hidden', marginBottom: 15 },
    hpBarFill: { height: '100%', backgroundColor: '#ff4444' },
    attackSection: { marginTop: 10, borderTopWidth:1, borderTopColor:'#444', paddingTop:10 },
    sectionLabel: { color:'#ccc', marginBottom:8, fontWeight:'bold', fontSize: 10, letterSpacing:1 },
    targetChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 15, borderWidth: 1, borderColor: '#555', marginRight: 6, backgroundColor:'#333' },
    input: { flex: 1, backgroundColor: '#121214', color: '#fff', padding: 8, borderRadius: 8, marginRight: 10, borderWidth: 1, borderColor: '#444', height: 40 },
    attackBtn: { backgroundColor: '#ff4444', paddingHorizontal: 15, borderRadius: 8, justifyContent:'center', height: 40 },
    skillCard: { backgroundColor: '#2a2a2a', padding: 10, borderRadius: 8, marginBottom: 6, borderLeftWidth: 3, borderLeftColor: '#8257e5' },
    skillName: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
    skillDesc: { color: '#ccc', marginTop: 2, fontSize: 12 },
    skillTarget: { marginTop: 4, fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase' },
    summonBtn: { flexDirection:'row', alignItems:'center', backgroundColor:'#FFD700', paddingHorizontal:8, paddingVertical:4, borderRadius:12 },
    summonBtnText: { color:'#000', fontSize:10, fontWeight:'bold' },
    minionCard: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'#18181B', padding:8, borderRadius:8, marginBottom:8, borderWidth:1, borderColor:'#333' },
    minionThumb: { width: 30, height: 30, borderRadius: 15, marginRight: 10 },
    minionName: { color:'#fff', fontWeight:'bold', fontSize:14 },
    minionControls: { flexDirection:'row', alignItems:'center' },
    minionHp: { color:'#fff', fontWeight:'bold', fontSize:16, marginHorizontal:2 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', padding:20 },
    modalContent: { backgroundColor: '#18181B', borderRadius: 12, padding: 20, maxHeight: '80%', borderWidth:1, borderColor:'#8257e5' },
    modalHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:15, borderBottomWidth:1, borderColor:'#333', paddingBottom:10 },
    modalTitle: { color:'#FFD700', fontSize:18, fontWeight:'bold', marginBottom: 15, textAlign:'center' },
    charItem: { flexDirection:'row', alignItems:'center', padding:10, borderBottomWidth:1, borderColor:'#333' },
    charItemImg: { width:40, height:40, borderRadius:20, marginRight:10 },
    charItemName: { color:'#fff', fontWeight:'bold' },
    
    // Novos estilos para o Modal
    label: { color:'#ccc', fontSize:12, marginBottom:5 },
    inputModal: { backgroundColor:'#222', color:'#fff', borderWidth:1, borderColor:'#444', borderRadius:8, padding:10, marginBottom:15 }
});