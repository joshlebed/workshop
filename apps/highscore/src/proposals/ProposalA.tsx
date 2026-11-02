// Proposal A — "You" is a page, not a menu.
// Tapping the avatar pushes a full screen: identity + today's stats, friend
// requests surfaced first, a friends preview, then settings as a quiet
// grouped list. Prior art: NYT Games "Me" tab, Strava "You", Duolingo Profile.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Avatar, Button, IconButton, PixelIcon, Text, tokens } from "../theme";
import {
  AvatarButton,
  Divider,
  HeaderIconButton,
  MockHeader,
  Phone,
  type ProfileData,
  proposalStyles as ps,
  Row,
  SectionLabel,
  Stat,
  TextLink,
} from "./shared";

type Screen = "home" | "me" | "friends";

export function ProposalA({ data }: { data: ProfileData }) {
  const [screen, setScreen] = useState<Screen>("me");
  const pending = data.inbound.length;

  if (screen === "home") {
    return (
      <Phone>
        <MockHeader
          right={
            <>
              <HeaderIconButton icon="copy" label="Copy today's scores" onPress={() => {}} />
              <AvatarButton data={data} badge={pending} onPress={() => setScreen("me")} />
            </>
          }
        />
        <View style={{ padding: tokens.space.lg, gap: tokens.space.sm }}>
          <Text tone="secondary">Home is unchanged. Tap your avatar.</Text>
        </View>
      </Phone>
    );
  }

  if (screen === "friends") {
    return (
      <Phone>
        <View style={ps.nav}>
          <IconButton accessibilityLabel="Back" onPress={() => setScreen("me")}>
            <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
          </IconButton>
          <Text variant="heading" style={ps.navTitle}>
            Friends
          </Text>
          <IconButton accessibilityLabel="Invite a friend" onPress={() => {}}>
            <PixelIcon name="plus" size={24} color={tokens.neon.pink} />
          </IconButton>
        </View>
        <ScrollView>
          {data.friends.map((f) => (
            <Row
              key={f.userId}
              leading={<Avatar name={f.displayName} size="sm" />}
              label={f.displayName ?? "Someone"}
              onPress={() => {}}
            />
          ))}
        </ScrollView>
      </Phone>
    );
  }

  return (
    <Phone>
      <View style={ps.nav}>
        <IconButton accessibilityLabel="Back" onPress={() => setScreen("home")}>
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </IconButton>
        <View style={ps.navTitle} />
        <IconButton accessibilityLabel="Edit profile" onPress={() => {}}>
          <PixelIcon name="pencil" size={24} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <ScrollView>
        <View style={ps.identity}>
          <Avatar name={data.name} imageUrl={data.avatarUrl} size="lg" />
          <View style={ps.identityText}>
            <Text variant="title" numberOfLines={1}>
              {data.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {data.email}
            </Text>
          </View>
        </View>
        <View style={ps.statsRow}>
          <Stat value={`${data.playedToday}/${data.games.length}`} label="played today" />
          <Stat
            value={data.bestStreak}
            label="best streak"
            tone={data.bestStreak > 0 ? "success" : "primary"}
          />
          <Stat value={data.friends.length} label="friends" />
        </View>

        {pending > 0 ? (
          <>
            <SectionLabel>{`Requests · ${pending}`}</SectionLabel>
            {data.inbound.slice(0, 3).map((r) => (
              <Row
                key={r.userId}
                leading={<Avatar name={r.displayName} size="sm" />}
                label={r.displayName ?? "Someone"}
                detail="wants to be friends"
                chevron={false}
                trailing={
                  <View style={{ flexDirection: "row", gap: tokens.space.xs }}>
                    <View style={ps.acceptBtn}>
                      <Text style={ps.acceptText}>Accept</Text>
                    </View>
                    <View style={ps.quietBtn}>
                      <Text style={ps.quietText}>Decline</Text>
                    </View>
                  </View>
                }
              />
            ))}
          </>
        ) : null}

        <SectionLabel right={<TextLink label="See all" onPress={() => setScreen("friends")} />}>
          {`Friends · ${data.friends.length}`}
        </SectionLabel>
        <View style={ps.pillRow}>
          {data.friends.slice(0, 8).map((f) => (
            <Avatar key={f.userId} name={f.displayName} size="md" />
          ))}
          {data.friends.length > 8 ? (
            <View
              style={{
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: tokens.bezel,
                borderColor: tokens.border.default,
              }}
            >
              <Text variant="caption" tone="secondary">
                +{data.friends.length - 8}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[ps.pad, { paddingVertical: tokens.space.sm }]}>
          <Button label="Invite a friend" variant="secondary" size="md" onPress={() => {}} />
        </View>
        {data.mutuals.length > 0 ? (
          <Row
            icon="users"
            label="People you may know"
            detail={`${data.mutuals.length} friends of friends`}
            onPress={() => {}}
          />
        ) : null}

        <SectionLabel>Account</SectionLabel>
        <Row
          icon="user"
          label="Edit profile"
          detail="Name, photo, blocked users"
          onPress={() => {}}
        />
        <Row icon="mail" label="Send feedback" onPress={() => {}} />
        {data.isAdmin ? <Row icon="sliders" label="Admin dashboard" onPress={() => {}} /> : null}
        <Divider />
        <Row icon="logout" label="Sign out" chevron={false} onPress={() => {}} />
        <View style={ps.linkRow}>
          <TextLink label="Support" />
          <TextLink label="Privacy" />
          <TextLink label="Terms" />
        </View>
      </ScrollView>
    </Phone>
  );
}
