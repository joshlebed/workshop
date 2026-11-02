// Proposal C — Friends hub, you included. The avatar opens one screen whose
// content is the social loop: your own row (tap to edit), friends ordered by
// today's activity, requests, suggestions. Everything that isn't the loop
// (feedback, support, legal, admin, sign out) sits behind a single ⋯
// overflow. Prior art: Snapchat / BeReal friends screens, Discord's friends
// list, Letterboxd's "You" with an overflow.
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Avatar, Button, IconButton, PixelIcon, Sheet, Text, tokens } from "../theme";
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
} from "./shared";

export function ProposalC({ data }: { data: ProfileData }) {
  const [open, setOpen] = useState(true);
  const [more, setMore] = useState(false);
  const pending = data.inbound.length;

  if (!open) {
    return (
      <Phone>
        <MockHeader
          right={
            <>
              <HeaderIconButton icon="copy" label="Copy today's scores" onPress={() => {}} />
              <AvatarButton data={data} badge={pending} onPress={() => setOpen(true)} />
            </>
          }
        />
        <View style={{ padding: tokens.space.lg }}>
          <Text tone="secondary">Home is unchanged. Tap your avatar.</Text>
        </View>
      </Phone>
    );
  }

  return (
    <Phone>
      <View style={ps.nav}>
        <IconButton accessibilityLabel="Back" onPress={() => setOpen(false)}>
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </IconButton>
        <Text variant="heading" style={ps.navTitle}>
          Friends
        </Text>
        <IconButton accessibilityLabel="Invite a friend" onPress={() => {}}>
          <PixelIcon name="plus" size={24} color={tokens.neon.pink} />
        </IconButton>
        <IconButton accessibilityLabel="More" onPress={() => setMore(true)}>
          <PixelIcon name="more-horizontal" size={24} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <ScrollView>
        <Row
          leading={<Avatar name={data.name} imageUrl={data.avatarUrl} size="md" />}
          label={data.name}
          detail={`${data.playedToday} of ${data.games.length} played today${data.bestStreak > 0 ? ` · ${data.bestStreak}-day streak` : ""}`}
          onPress={() => {}}
          testID="proposal-c-self"
        />
        {pending > 0 ? (
          <>
            <SectionLabel>{`Requests · ${pending}`}</SectionLabel>
            {data.inbound.map((r) => (
              <Row
                key={r.userId}
                leading={<Avatar name={r.displayName} size="sm" />}
                label={r.displayName ?? "Someone"}
                chevron={false}
                trailing={
                  <View style={ps.acceptBtn}>
                    <Text style={ps.acceptText}>Accept</Text>
                  </View>
                }
              />
            ))}
          </>
        ) : null}
        <SectionLabel>{`Friends · ${data.friends.length}`}</SectionLabel>
        {data.friends.map((f, i) => (
          <Row
            key={f.userId}
            leading={<Avatar name={f.displayName} size="sm" />}
            label={f.displayName ?? "Someone"}
            detail={
              i % 3 === 0 ? "played today" : i % 3 === 1 ? "played yesterday" : "quiet this week"
            }
            trailing={
              i % 3 === 0 ? <Stat value={1 + (i % 4)} label="games" tone="success" /> : undefined
            }
            onPress={() => {}}
          />
        ))}
        {data.mutuals.length > 0 ? (
          <>
            <SectionLabel>People you may know</SectionLabel>
            {data.mutuals.slice(0, 4).map((m) => (
              <Row
                key={m.userId}
                leading={<Avatar name={m.displayName} size="sm" />}
                label={m.displayName ?? "Someone"}
                detail={`${m.mutualCount} mutual`}
                chevron={false}
                trailing={
                  <View style={ps.quietBtn}>
                    <Text style={ps.quietText}>Add</Text>
                  </View>
                }
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      <Sheet visible={more} onRequestClose={() => setMore(false)}>
        <Row icon="mail" label="Send feedback" chevron={false} onPress={() => setMore(false)} />
        <Row icon="link" label="Support" chevron={false} onPress={() => setMore(false)} />
        <Row label="Privacy policy" chevron={false} onPress={() => setMore(false)} />
        <Row label="Terms of use" chevron={false} onPress={() => setMore(false)} />
        {data.isAdmin ? (
          <Row
            icon="sliders"
            label="Admin dashboard"
            chevron={false}
            onPress={() => setMore(false)}
          />
        ) : null}
        <Divider />
        <Button label="Sign out" variant="ghost" onPress={() => setMore(false)} />
      </Sheet>
    </Phone>
  );
}
