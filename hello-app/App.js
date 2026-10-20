import { StatusBar } from 'expo-status-bar';
import {
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>ִ ࣪ ˖ ࣪ ᨰꫀᥣᥴ᥆ꩇꫀ to Ponyville! ᰔ ִ ׄ</Text>

        <Image
          source={require('./assets/project5/mlp.gif')}
          style={styles.heroImage}
          resizeMode="contain"
          accessibilityLabel="My Little Pony"
        />

        <View style={styles.intro}>
          <Text style={styles.heading}>My Little Pony</Text>
          <Text style={styles.subtitle}>I used to wonder what friendship could be</Text>
          <Text style={styles.subtitle}>Until you all shared its magic with me</Text>
        </View>

        <PonyCard
          title="Big Adventure"
          image={require('./assets/project5/dashie.gif')}
          accessibilityLabel="Rainbow Dash"
        />
        <PonyCard
          title="Tons of fun"
          image={require('./assets/project5/pinkie.gif')}
          accessibilityLabel="Pinkie Pie"
        />
        <PonyCard
          title="A beautiful heart"
          image={require('./assets/project5/rarity.gif')}
          accessibilityLabel="Rarity"
        />
        <PonyCard
          title="Faithful and Strong"
          image={require('./assets/project5/jack.gif')}
          accessibilityLabel="Applejack"
        />
        <PonyCard
          title="Sharing kindness"
          image={require('./assets/project5/fluttershy.gif')}
          accessibilityLabel="Fluttershy"
        />

        <View style={styles.finalMessage}>
          <Text style={styles.subtitle}>
            It&apos;s an easy feat &amp; magic makes it all complete
          </Text>
          <Image
            source={require('./assets/project5/twilight.gif')}
            style={styles.ponyImage}
            resizeMode="contain"
            accessibilityLabel="Twilight Sparkle"
          />
          <Text style={styles.subtitle}>
            You have my little ponies, do you know you&apos;re all my very best
            friends?
          </Text>
        </View>
      </ScrollView>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

function PonyCard({ title, image, accessibilityLabel }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Image
        source={image}
        style={styles.ponyImage}
        resizeMode="contain"
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  title: {
    color: '#f0438c',
    fontFamily: 'Georgia',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  heroImage: {
    height: 220,
    marginBottom: 28,
    maxWidth: 750,
    width: '100%',
  },
  intro: {
    alignItems: 'center',
    marginBottom: 16,
  },
  heading: {
    color: '#222222',
    fontFamily: 'Verdana',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#222222',
    fontFamily: 'Verdana',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  card: {
    alignItems: 'center',
    marginVertical: 10,
    width: '100%',
  },
  cardTitle: {
    color: '#222222',
    fontFamily: 'Verdana',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  ponyImage: {
    height: 220,
    marginTop: 8,
    maxWidth: 220,
    width: '100%',
  },
  finalMessage: {
    alignItems: 'center',
    marginTop: 10,
  },
});
