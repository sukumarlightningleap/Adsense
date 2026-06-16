import { Megaphone } from "lucide-react";

import { PlaceholderPage } from "@/components/shared/placeholder-page";

export default function CampaignsPage() {
  return (
    <PlaceholderPage
      icon={Megaphone}
      title="Campaigns"
      body="List every campaign across every connected account, filter by status / channel / spend, and drill into a campaign for ad groups, keywords, KPIs, and bidding."
      comingIn="PHASE 2"
    />
  );
}
