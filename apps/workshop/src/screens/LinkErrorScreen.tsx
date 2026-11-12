import {
  Button,
  EmptyState,
  layout,
  Screen,
  ScreenHeader,
  screenColumnStyle,
  tokens,
} from "@workshop/ui";
import { ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../lib/goBack";

/**
 * A share or invite link that couldn't open its list (4.6). One plain
 * sentence and one way forward: Retry when it might work next time (network,
 * server), Go to your lists when it won't (not found, malformed link).
 */
export function LinkErrorScreen({
  title,
  message,
  onRetry,
  retrying,
  testID,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retrying?: boolean;
  testID?: string;
}) {
  return (
    <Screen style={styles.root} testID={testID}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="link-error-back"
      />
      <ScrollView contentContainerStyle={[styles.body, screenColumnStyle]}>
        <EmptyState
          title={title}
          description={message}
          action={
            <View style={styles.actions}>
              {onRetry ? (
                <Button
                  label="Try again"
                  onPress={onRetry}
                  loading={retrying}
                  testID="link-error-retry"
                />
              ) : null}
              <Button
                label="Go to your lists"
                variant={onRetry ? "ghost" : "secondary"}
                onPress={() => goBack("/")}
                testID="link-error-home"
              />
            </View>
          }
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { flexGrow: 1, justifyContent: "center", paddingBottom: layout.bottomInset },
  actions: { gap: tokens.space.sm, alignItems: "center" },
});
