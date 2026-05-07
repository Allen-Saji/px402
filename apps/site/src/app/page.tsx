import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Integration } from "@/components/Integration";
import { Packages } from "@/components/Packages";
import { DemoCallout } from "@/components/DemoCallout";
import { PrivacyProof } from "@/components/PrivacyProof";
import { HonestScope } from "@/components/HonestScope";
import { Footer } from "@/components/Footer";
import { getStarCount } from "@/lib/github";

export const revalidate = 3600;

export default async function Home() {
  const stars = await getStarCount();

  return (
    <>
      <Nav stars={stars} />
      <main>
        <Hero stars={stars} />
        <HowItWorks />
        <Integration />
        <Packages />
        <DemoCallout />
        <PrivacyProof />
        <HonestScope />
      </main>
      <Footer />
    </>
  );
}
