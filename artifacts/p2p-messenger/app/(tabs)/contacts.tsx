import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@/components/AppIcons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ConnectionBanner from '@/components/ConnectionBanner';
import { useColors } from '@/hooks/useColors';
import { useMessenger } from '@/context/MessengerContext';
import { resolveIdentityUsername } from '@/lib/crypto';
import type { Contact, DirectoryProfile } from '@/lib/types';

function avatarText(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    identity,
    contacts,
    directoryProfiles,
    connectionStatus,
    refreshDirectory,
    addContact,
    removeContact,
    reconnectContact,
  } = useMessenger();

  const [search, setSearch] = useState('');
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  const myUsername = identity ? resolveIdentityUsername(identity) : '';
  const query = search.trim().replace(/^@+/, '').toLowerCase();

  const filteredContacts = useMemo(() => {
    if (!query) return contacts;
    return contacts.filter((contact) => {
      const handle = resolveIdentityUsername(contact).toLowerCase();
      return (
        contact.displayName.toLowerCase().includes(query) ||
        handle.includes(query)
      );
    });
  }, [contacts, query]);

  const discoverablePeople = useMemo(() => {
    const existingIds = new Set(contacts.map((c) => c.id));
    return directoryProfiles.filter((profile) => {
      if (existingIds.has(profile.signPublic)) return false;
      if (profile.signPublic === identity?.signPublic) return false;
      if (!query) return true;
      return (
        profile.displayName.toLowerCase().includes(query) ||
        profile.username.toLowerCase().includes(query)
      );
    });
  }, [directoryProfiles, contacts, identity?.signPublic, query]);

  const copyMyHandle = async () => {
    if (!myUsername) return;
    await Clipboard.setStringAsync(`@${myUsername}`);
    setCopiedHandle(true);
    setTimeout(() => setCopiedHandle(false), 1800);
  };

  const handleStartChatWithProfile = async (profile: DirectoryProfile) => {
    if (addingId) return;
    setAddingId(profile.signPublic);
    try {
      const contact = await addContact({
        signPublic: profile.signPublic,
        boxPublic: profile.boxPublic,
        displayName: profile.displayName,
        username: profile.username,
      });
      router.push({ pathname: '/chat/[id]', params: { id: contact.id } });
    } catch (reason) {
      Alert.alert(
        'Could not add contact',
        reason instanceof Error ? reason.message : 'Please try again.',
      );
    } finally {
      setAddingId(null);
    }
  };

  const confirmRemove = (contact: Contact) => {
    Alert.alert(
      'Remove contact?',
      `${contact.displayName} and the chat history on this device will be removed.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void removeContact(contact.id),
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 16) + 8,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>
            PEOPLE & CONTACTS
          </Text>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Contacts
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Refresh directory"
          onPress={() => refreshDirectory()}
          style={[
            styles.refreshBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="radio" size={16} color={colors.primary} />
          <Text style={[styles.refreshBtnText, { color: colors.foreground }]}>
            Discover
          </Text>
        </Pressable>
      </View>

      <ConnectionBanner />

      <View
        style={[
          styles.search,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by @username or name…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <Feather name="x-circle" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollBody,
          { paddingBottom: Math.max(insets.bottom, 34) + 92 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {myUsername ? (
          <Pressable
            onPress={() => void copyMyHandle()}
            style={[
              styles.myHandleCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={[styles.handleIconBox, { backgroundColor: colors.accent }]}>
              <Feather name="at-sign" size={18} color={colors.primary} />
            </View>
            <View style={styles.handleCopy}>
              <Text style={[styles.handleLabel, { color: colors.mutedForeground }]}>
                YOUR USERNAME · TAP TO COPY
              </Text>
              <Text style={[styles.handleValue, { color: colors.foreground }]}>
                @{myUsername}
              </Text>
            </View>
            <View
              style={[
                styles.copyPill,
                { backgroundColor: colors.secondary, borderColor: colors.border },
              ]}
            >
              <Feather
                name={copiedHandle ? 'check' : 'copy'}
                size={13}
                color={colors.primary}
              />
              <Text style={[styles.copyPillText, { color: colors.primary }]}>
                {copiedHandle ? 'Copied' : 'Share'}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            {query ? 'MATCHING PEOPLE ON P2P MESSENGER' : 'PEOPLE ONLINE NOW'}
          </Text>
          <View
            style={[
              styles.countBadge,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.countBadgeText, { color: colors.primary }]}>
              {discoverablePeople.length}
            </Text>
          </View>
        </View>

        {discoverablePeople.length > 0 ? (
          <View style={styles.sectionList}>
            {discoverablePeople.map((profile) => {
              const isAdding = addingId === profile.signPublic;
              return (
                <View
                  key={profile.signPublic}
                  style={[
                    styles.contactCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.contactMain}>
                    <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                      <Text
                        style={[
                          styles.avatarText,
                          { color: colors.accentForeground },
                        ]}
                      >
                        {avatarText(profile.displayName)}
                      </Text>
                      <View
                        style={[
                          styles.presenceDot,
                          {
                            backgroundColor: colors.primary,
                            borderColor: colors.card,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.copy}>
                      <Text
                        numberOfLines={1}
                        style={[styles.name, { color: colors.foreground }]}
                      >
                        {profile.displayName}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[styles.usernameSub, { color: colors.primary }]}
                      >
                        @{profile.username}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    onPress={() => void handleStartChatWithProfile(profile)}
                    disabled={isAdding}
                    style={[
                      styles.messagePillBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: isAdding ? 0.65 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name="message-circle"
                      size={14}
                      color={colors.primaryForeground}
                    />
                    <Text
                      style={[
                        styles.messagePillText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      {isAdding ? 'Adding…' : 'Message'}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View
            style={[
              styles.directoryHintCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <MaterialCommunityIcons
              name="account-search-outline"
              size={22}
              color={colors.primary}
            />
            <Text style={[styles.directoryHintText, { color: colors.mutedForeground }]}>
              {query
                ? `No new users matching "@${query}" are online right now. Ask your friend to open P2P Messenger so their @username appears here.`
                : 'When friends open P2P Messenger on their phone, their @username automatically appears here for 1-tap messaging.'}
            </Text>
          </View>
        )}

        <View style={[styles.sectionHeader, { marginTop: 18 }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            MY CONTACTS ({filteredContacts.length})
          </Text>
        </View>

        {filteredContacts.length > 0 ? (
          <View style={styles.sectionList}>
            {filteredContacts.map((item) => {
              const status = connectionStatus[item.id] ?? 'searching';
              const isConnected = status === 'connected';
              const handle = resolveIdentityUsername(item);
              return (
                <View
                  key={item.id}
                  style={[
                    styles.contactCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: isConnected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/chat/[id]', params: { id: item.id } })
                    }
                    style={styles.contactMain}
                  >
                    <View
                      style={[styles.avatar, { backgroundColor: colors.accent }]}
                    >
                      <Text
                        style={[
                          styles.avatarText,
                          { color: colors.accentForeground },
                        ]}
                      >
                        {avatarText(item.displayName)}
                      </Text>
                      <View
                        style={[
                          styles.presenceDot,
                          {
                            backgroundColor: isConnected
                              ? colors.primary
                              : status === 'searching'
                                ? '#F59E0B'
                                : colors.mutedForeground,
                            borderColor: colors.card,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.copy}>
                      <View style={styles.nameRow}>
                        <Text
                          numberOfLines={1}
                          style={[styles.name, { color: colors.foreground }]}
                        >
                          {item.displayName}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor: isConnected
                                ? colors.accent
                                : colors.secondary,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              {
                                color: isConnected
                                  ? colors.primary
                                  : colors.mutedForeground,
                              },
                            ]}
                          >
                            {isConnected ? 'ONLINE' : 'SYNCING'}
                          </Text>
                        </View>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[styles.status, { color: colors.mutedForeground }]}
                      >
                        @{handle} · {isConnected ? 'Encrypted tunnel live' : 'Tap to message'}
                      </Text>
                    </View>
                  </Pressable>

                  {!isConnected ? (
                    <Pressable
                      accessibilityLabel={`Ping ${item.displayName}`}
                      onPress={() => void reconnectContact(item.id)}
                      style={[
                        styles.actionIconBtn,
                        { backgroundColor: colors.secondary },
                      ]}
                    >
                      <Feather name="refresh-cw" size={14} color={colors.primary} />
                    </Pressable>
                  ) : null}

                  <Pressable
                    accessibilityLabel={`Remove ${item.displayName}`}
                    onPress={() => confirmRemove(item)}
                    style={styles.removeButton}
                  >
                    <Feather
                      name="user-minus"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {query ? 'No saved contacts match' : 'No saved contacts yet'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Search any friend’s @username above and tap Message to start an
              end-to-end encrypted chat automatically.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 13,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 1,
  },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  refreshBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtnText: { fontSize: 12, fontWeight: '800' },
  search: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
  },
  searchInput: { flex: 1, paddingVertical: 0, fontSize: 13.5 },
  scrollBody: { paddingHorizontal: 16, paddingTop: 6 },
  myHandleCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 16,
  },
  handleIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleCopy: { flex: 1 },
  handleLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.9 },
  handleValue: { fontSize: 15, fontWeight: '800', marginTop: 1 },
  copyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  copyPillText: { fontSize: 11.5, fontWeight: '800' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  countBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  countBadgeText: { fontSize: 10, fontWeight: '800' },
  sectionList: { gap: 9 },
  directoryHintCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  directoryHintText: { flex: 1, fontSize: 12, lineHeight: 17 },
  contactCard: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '800' },
  presenceDot: {
    width: 12,
    height: 12,
    borderWidth: 2,
    borderRadius: 6,
    position: 'absolute',
    right: -2,
    bottom: -2,
  },
  copy: { flex: 1, gap: 3 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  name: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  usernameSub: { fontSize: 12.5, fontWeight: '700' },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  status: { fontSize: 11.5 },
  messagePillBtn: {
    height: 36,
    paddingHorizontal: 13,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  messagePillText: { fontSize: 12.5, fontWeight: '800' },
  actionIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 18,
  },
  emptyTitle: { fontSize: 15, fontWeight: '800' },
  emptyText: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
});
