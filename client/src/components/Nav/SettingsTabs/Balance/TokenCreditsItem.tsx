import React from 'react';
import { Label, InfoHoverCard, ESide } from '@librechat/client';
import { creditsToInr, formatInr } from '~/utils';
import { useLocalize } from '~/hooks';

interface TokenCreditsItemProps {
  tokenCredits?: number;
}

const TokenCreditsItem: React.FC<TokenCreditsItemProps> = ({ tokenCredits }) => {
  const localize = useLocalize();

  return (
    <div className="flex items-center justify-between">
      {/* Left Section: Label */}
      <div className="flex items-center space-x-2">
        <Label className="font-light">{localize('com_nav_balance')}</Label>
        <InfoHoverCard side={ESide.Bottom} text={localize('com_nav_info_balance')} />
      </div>

      {/* Right Section: Balance in INR */}
      <span className="text-sm font-medium text-text-primary" role="note">
        {formatInr(creditsToInr(tokenCredits ?? 0))}
      </span>
    </div>
  );
};

export default TokenCreditsItem;
