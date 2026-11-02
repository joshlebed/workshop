// Proposal B — Friends is first-class in the header; the avatar opens a
// small account sheet. Two triggers, two jobs: the social loop gets its own
// icon + badge; identity/sign-out stay a two-tap sheet; help/legal move to
// a gear on the Friends page. Prior art: Duolingo (Friends tab + gear),
// Game Center, Instagram's notifications-vs-profile split.
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
} from "./shared";

type Screen = "home" | "friends" | "settings";

export function ProposalB({ data }: { data: ProfileData }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [sheet, setSheet] = useState(false);
  const pending = data.inbound.length;

  const header = (
    <MockHeader
      right={
        <>
          <HeaderIconButton icon="copy" label="Copy today's scores" onPress={() => {}} />
          <HeaderIconButton
            icon="users"
            label="Friends"
            badge={pending}
            active={screen === "friends"}
            onPress={() => setScreen("friends")}
          />
          <AvatarButton data={data} onPress={() => setSheet(true)} />
        </>
      }
    />
  );

  return (
    <Phone>
      {screen === "home" ? (
        <>
          {header}
          <View style={{ padding: tokens.space.lg, gap: tokens.space.sm }}>
            <Text tone="secondary">
              Home is unchanged. The friends icon carries the request badge; the avatar is just you.
            </Text>
          </View>
        </>
      ) : screen === "friends" ? (
        <>
          <View style={ps.nav}>
            <IconButton accessibilityLabel="Back" onPress={() => setScreen("home")}>
              <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
            </IconButton>
            <Text variant="heading" style={ps.navTitle}>
              Friends
            </Text>
            <IconButton
              accessibilityLabel="Settings and help"
              onPress={() => setScreen("settings")}
            >
              <PixelIcon name="sliders" size={24} color={tokens.text.secondary} />
            </IconButton>
          </View>
          <ScrollView>
            <View style={[ps.pad, { paddingVertical: tokens.space.sm }]}>
              <Button label="Invite a friend" onPress={() => {}} />
            </View>
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
            {data.friends.map((f) => (
              <Row
                key={f.userId}
                leading={<Avatar name={f.displayName} size="sm" />}
                label={f.displayName ?? "Someone"}
                onPress={() => {}}
              />
            ))}
            {data.mutuals.length > 0 ? (
              <>
                <SectionLabel>People you may know</SectionLabel>
                {data.mutuals.slice(0, 5).map((m) => (
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
        </>
      ) : (
        <>
          <View style={ps.nav}>
            <IconButton accessibilityLabel="Back" onPress={() => setScreen("friends")}>
              <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
            </IconButton>
            <Text variant="heading" style={ps.navTitle}>
              Settings
            </Text>
          </View>
          <ScrollView>
            <SectionLabel>Help</SectionLabel>
            <Row icon="mail" label="Send feedback" onPress={() => {}} />
            <Row icon="link" label="Support" onPress={() => {}} />
            <SectionLabel>Legal</SectionLabel>
            <Row label="Privacy policy" onPress={() => {}} />
            <Row label="Terms of use" onPress={() => {}} />
            {data.isAdmin ? (
              <>
                <SectionLabel>Admin</SectionLabel>
                <Row icon="sliders" label="Admin dashboard" onPress={() => {}} />
              </>
            ) : null}
          </ScrollView>
        </>
      )}

      <Sheet visible={sheet} onRequestClose={() => setSheet(false)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md }}>
          <Avatar name={data.name} imageUrl={data.avatarUrl} size="lg" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="heading" numberOfLines={1}>
              {data.name}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {data.email}
            </Text>
          </View>
        </View>
        <Button label="Edit profile" variant="secondary" onPress={() => setSheet(false)} />
        <Divider />
        <Button label="Sign out" variant="ghost" onPress={() => setSheet(false)} />
      </Sheet>
    </Phone>
  );
}
