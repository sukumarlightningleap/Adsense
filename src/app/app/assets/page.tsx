import { ImageIcon } from "lucide-react";

import { PlaceholderPage } from "@/components/shared/placeholder-page";

export default function AssetsPage() {
  return (
    <PlaceholderPage
      icon={ImageIcon}
      title="Assets"
      body="Asset library — every image, logo, and ad creative uploaded across all accounts. Generate ad posters with the nano-banana image pipeline and link them to PMax asset groups."
      comingIn="PHASE 3"
    />
  );
}
