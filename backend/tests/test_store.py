"""The shop's Meta Ads numbers (routers/markets.py): the rates are worked out from Meta's counts, campaigns come dearest first."""
import asyncio

import httpx

from app.config import settings
from app.routers import markets

ROW = {"spend": "50.00", "impressions": "10000", "reach": "4000", "clicks": "260", "inline_link_clicks": "200",
       "actions": [{"action_type": "landing_page_view", "value": "150"}, {"action_type": "add_to_cart", "value": "20"},
                   {"action_type": "purchase", "value": "5"}, {"action_type": "offsite_conversion.fb_pixel_purchase", "value": "5"}],
       "action_values": [{"action_type": "purchase", "value": "175.0"}]}


def test_meta_row_works_out_the_rates_on_link_clicks():
    out = markets._meta_row(ROW)
    assert (out["clicks"], out["ctr"], out["cpc"], out["cpm"], out["frequency"]) == (200, 2.0, 0.25, 5.0, 2.5)
    assert (out["views"], out["carts"], out["purchases"], out["purchase_value"], out["roas"]) == (150, 20, 5, 175.0, 3.5)


def test_meta_row_with_nothing_spent_has_no_rates():
    out = markets._meta_row({})
    assert out["spend"] == 0 and out["ctr"] is None and out["cpc"] is None and out["cpm"] is None and out["frequency"] is None and out["roas"] is None


def test_meta_lists_the_campaigns_that_spent_dearest_first(monkeypatch):
    monkeypatch.setattr(settings, "meta_access_token", "t")
    monkeypatch.setattr(settings, "meta_ad_account", "123")

    async def get(self, url, **kw):
        assert url.endswith("/act_123/insights")
        rows = [ROW]
        if kw["params"].get("level") == "campaign":
            rows = [{**ROW, "campaign_name": "small", "spend": "10"}, {**ROW, "campaign_name": "off", "spend": "0"}, {**ROW, "campaign_name": "big", "spend": "40"}]
        return httpx.Response(200, json={"data": rows})

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    out = asyncio.run(markets._meta())
    assert out["source"] == "live" and out["today"]["spend"] == 50.0
    assert [c["name"] for c in out["month"]["campaigns"]] == ["big", "small"]


def test_meta_error_is_told_not_hidden(monkeypatch):
    monkeypatch.setattr(settings, "meta_access_token", "t")
    monkeypatch.setattr(settings, "meta_ad_account", "act_1")

    async def get(self, url, **kw):
        return httpx.Response(400, json={"error": {"message": "Invalid OAuth access token."}})

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    assert asyncio.run(markets._meta()) == {"source": "error", "error": "Invalid OAuth access token."}
