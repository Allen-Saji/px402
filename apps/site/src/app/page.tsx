import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Integration } from "@/components/Integration";
import { Packages } from "@/components/Packages";
import { DemoCallout } from "@/components/DemoCallout";
import { PrivacyProof } from "@/components/PrivacyProof";
import { HonestScope } from "@/components/HonestScope";
import { Footer } from "@/components/Footer";

export const revalidate = 3600;

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <PrivacyProof />
        <HowItWorks />
        <Integration />
        <DemoCallout />
        <Packages />
        <HonestScope />
      </main>
      <Footer />
    </>
  );
}
