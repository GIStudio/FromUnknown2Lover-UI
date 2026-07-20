#!/usr/bin/env python3
"""Browser smoke check for the metric map, replay projection, and editor draft."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


REPLAY = "packed_encounter_14_20260719_064154.json"
EXPECTED_STEP_13 = {
    "night-school": 11,
    "cultural": 8,
    "entertainment": 8,
    "bar": 3,
}
EXPECTED_STEP_7 = {
    "night-school": 10,
    "cultural": 8,
    "entertainment": 8,
    "bar": 4,
}


def installed_chromium() -> Path | None:
    cache_root = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "~/Library/Caches/ms-playwright")).expanduser()
    candidates = sorted(cache_root.glob("chromium_headless_shell-*/chrome-headless-shell-mac-*/chrome-headless-shell"))
    return candidates[-1] if candidates else None


def set_step(page: Page, step_index: int) -> None:
    page.locator("#timeline").evaluate(
        "(element, value) => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }",
        str(step_index),
    )
    page.wait_for_timeout(100)


def assert_stage_ratio(page: Page, selector: str) -> dict[str, float]:
    box = page.locator(selector).bounding_box()
    assert box, f"Missing stage: {selector}"
    ratio = box["width"] / box["height"]
    assert abs(ratio - (2 / 3)) < 0.01, f"Expected 2:3 stage, got {ratio:.4f}"
    return box


def assert_stage_fits_world(page: Page) -> None:
    world = page.locator(".world").bounding_box()
    stage = page.locator("#world-stage").bounding_box()
    assert world and stage
    assert stage["width"] <= world["width"] + 1
    assert stage["height"] <= world["height"] + 1


def assert_legend_does_not_cover_stage(page: Page) -> dict[str, float]:
    legend = page.locator(".map-key").bounding_box()
    stage = page.locator("#world-stage").bounding_box()
    assert legend and stage
    separated = (
        legend["y"] + legend["height"] <= stage["y"] + 1
        or stage["y"] + stage["height"] <= legend["y"] + 1
        or legend["x"] + legend["width"] <= stage["x"] + 1
        or stage["x"] + stage["width"] <= legend["x"] + 1
    )
    assert separated, "Map legend overlaps the map stage"
    return legend


def assert_agents_inside_mapped_objects(page: Page) -> None:
    failures = page.evaluate(
        """
        () => [...document.querySelectorAll('#agent-layer .agent[data-map-object-id]')].flatMap((agent) => {
          const target = document.querySelector(`#map-layer [data-map-object-id="${agent.dataset.mapObjectId}"]`);
          if (!target) return [`${agent.dataset.agentId}: missing ${agent.dataset.mapObjectId}`];
          const x = Number.parseFloat(agent.style.left);
          const y = Number.parseFloat(agent.style.top);
          const left = Number.parseFloat(target.style.left);
          const top = Number.parseFloat(target.style.top);
          const right = left + Number.parseFloat(target.style.width);
          const bottom = top + Number.parseFloat(target.style.height);
          return x >= left && x <= right && y >= top && y <= bottom
            ? []
            : [`${agent.dataset.agentId}: ${x},${y} outside ${left},${top},${right},${bottom}`];
        })
        """
    )
    assert failures == [], "Mapped Agent outside target: " + "; ".join(failures)


def replay_counts(page: Page) -> dict[str, int]:
    return {
        object_id: page.locator(f'#agent-layer .agent[data-map-object-id="{object_id}"]').count()
        for object_id in EXPECTED_STEP_13
    }


def counts_for(page: Page, expected: dict[str, int]) -> dict[str, int]:
    return {
        object_id: page.locator(f'#agent-layer .agent[data-map-object-id="{object_id}"]').count()
        for object_id in expected
    }


def assert_step_seven_dialogue_layout(page: Page) -> dict[str, object]:
    set_step(page, 7)
    counts = counts_for(page, EXPECTED_STEP_7)
    assert counts == EXPECTED_STEP_7, f"Unexpected Step 7 distribution: {counts}"
    assert page.locator("#relation-layer .conversation-outline").count() == 10
    assert page.locator("#relation-layer .conversation-line").count() == 10
    assert page.locator("#agent-layer .agent.is-conversing").count() == 20
    assert page.locator("#relation-layer").get_attribute("preserveAspectRatio") == "none"

    bubble_button = page.locator("#bubble-demo-button")
    assert bubble_button.get_attribute("aria-pressed") == "true"
    first_bubble_state = page.locator("#agent-layer .agent.is-demo-speaking .speech-bubble").evaluate_all(
        "bubbles => bubbles.map(bubble => ({ agent: bubble.closest('.agent').dataset.agentId, event: bubble.dataset.eventId, turn: Number(bubble.dataset.turnIndex), role: bubble.dataset.speakerRole, text: bubble.querySelector('.speech-content').textContent })).sort((a, b) => a.event.localeCompare(b.event))"
    )
    first_bubble_agents = sorted(item["agent"] for item in first_bubble_state)
    assert 2 <= len(first_bubble_agents) <= 3
    assert page.locator("#agent-layer .agent.is-demo-speaking .speech-bubble").count() == len(first_bubble_agents)
    assert page.locator("#agent-layer .agent.is-demo-speaking .speech-speaker").count() == len(first_bubble_agents)
    assert page.locator("#agent-layer .agent.is-demo-speaking .progress-ribbon").count() == len(first_bubble_agents)
    assert page.locator("#agent-layer .agent.is-demo-speaking .progress-metric").count() == len(first_bubble_agents) * 3
    assert max(len(item["text"]) for item in first_bubble_state) > 42
    assert all(not item["text"].endswith("…") for item in first_bubble_state)
    page.wait_for_timeout(300)
    assert page.locator("#agent-layer .agent.is-demo-speaking .speech-bubble").evaluate_all(
        "bubbles => bubbles.every(bubble => Number.parseFloat(getComputedStyle(bubble).opacity) > 0.9)"
    )
    bubble_overlaps = page.locator("#agent-layer .agent.is-demo-speaking .speech-bubble").evaluate_all(
        """
        bubbles => {
          const stage = document.querySelector('#world-stage').getBoundingClientRect();
          const boundsFailures = bubbles.flatMap((bubble) => {
            const rect = bubble.getBoundingClientRect();
            return rect.left >= stage.left - 2 && rect.right <= stage.right + 2 && rect.top >= stage.top - 2 && rect.bottom <= stage.bottom + 2
              ? [] : [`outside-stage:${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.right.toFixed(1)},${rect.bottom.toFixed(1)}`];
          });
          const overlaps = bubbles.flatMap((bubble, index) => bubbles.slice(index + 1).flatMap((other) => {
          const first = bubble.getBoundingClientRect();
          const second = other.getBoundingClientRect();
          const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
          const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
          return width > 2 && height > 2 ? [`${width.toFixed(1)}x${height.toFixed(1)}`] : [];
          }));
          return [...boundsFailures, ...overlaps];
        }
        """
    )
    assert bubble_overlaps == [], "Visible demo bubbles overlap: " + "; ".join(bubble_overlaps)
    page.wait_for_timeout(1900)
    second_bubble_state = page.locator("#agent-layer .agent.is-demo-speaking .speech-bubble").evaluate_all(
        "bubbles => bubbles.map(bubble => ({ agent: bubble.closest('.agent').dataset.agentId, event: bubble.dataset.eventId, turn: Number(bubble.dataset.turnIndex), role: bubble.dataset.speakerRole })).sort((a, b) => a.event.localeCompare(b.event))"
    )
    second_bubble_agents = sorted(item["agent"] for item in second_bubble_state)
    assert 2 <= len(second_bubble_agents) <= 3
    assert {item["event"] for item in first_bubble_state} == {item["event"] for item in second_bubble_state}
    assert any(first["turn"] != second["turn"] for first, second in zip(first_bubble_state, second_bubble_state)), "Encounter turn did not advance"
    assert any(first["role"] != second["role"] for first, second in zip(first_bubble_state, second_bubble_state)), "Speaker role did not advance"
    bubble_button.click()
    assert bubble_button.get_attribute("aria-pressed") == "false"
    assert page.locator("#agent-layer .agent.is-demo-speaking").count() == 0
    bubble_button.click()
    assert bubble_button.get_attribute("aria-pressed") == "true"
    assert 2 <= page.locator("#agent-layer .agent.is-demo-speaking").count() <= 3

    overlap_failures = page.evaluate(
        """
        () => {
          const agents = [...document.querySelectorAll('#agent-layer .agent')].map((agent) => ({
            id: agent.dataset.agentId,
            objectId: agent.dataset.mapObjectId,
            conversationId: agent.dataset.conversationId || null,
            rect: agent.querySelector('.agent-sprite').getBoundingClientRect(),
          }));
          const failures = [];
          agents.forEach((first, index) => agents.slice(index + 1).forEach((second) => {
            if (!first.objectId || first.objectId !== second.objectId) return;
            if (first.conversationId && first.conversationId === second.conversationId) return;
            const width = Math.min(first.rect.right, second.rect.right) - Math.max(first.rect.left, second.rect.left);
            const height = Math.min(first.rect.bottom, second.rect.bottom) - Math.max(first.rect.top, second.rect.top);
            if (width > 1 && height > 1) failures.push(`${first.id}/${second.id}:${width.toFixed(1)}x${height.toFixed(1)}`);
          }));
          return failures;
        }
        """
    )
    assert overlap_failures == [], "Non-dialogue sprite overlap: " + "; ".join(overlap_failures)

    alignment_failures = page.evaluate(
        """
        () => {
          const stage = document.querySelector('#world-stage').getBoundingClientRect();
          return [...document.querySelectorAll('.conversation-line')].flatMap((line) => {
            const id = line.dataset.conversationId;
            const agents = [...document.querySelectorAll(`.agent[data-conversation-id="${id}"]`)];
            if (agents.length !== 2) return [`${id}: ${agents.length} agents`];
            const endpoints = [
              { x: stage.left + Number(line.getAttribute('x1')) / 100 * stage.width, y: stage.top + Number(line.getAttribute('y1')) / 100 * stage.height },
              { x: stage.left + Number(line.getAttribute('x2')) / 100 * stage.width, y: stage.top + Number(line.getAttribute('y2')) / 100 * stage.height },
            ];
            const anchors = agents.map((agent) => ({
              x: stage.left + Number.parseFloat(agent.style.left) / 100 * stage.width,
              y: stage.top + Number.parseFloat(agent.style.top) / 100 * stage.height,
            }));
            const direct = Math.hypot(endpoints[0].x - anchors[0].x, endpoints[0].y - anchors[0].y)
              + Math.hypot(endpoints[1].x - anchors[1].x, endpoints[1].y - anchors[1].y);
            const reversed = Math.hypot(endpoints[0].x - anchors[1].x, endpoints[0].y - anchors[1].y)
              + Math.hypot(endpoints[1].x - anchors[0].x, endpoints[1].y - anchors[0].y);
            return Math.min(direct, reversed) <= 2 ? [] : [`${id}: ${Math.min(direct, reversed).toFixed(2)}px`];
          });
        }
        """
    )
    assert alignment_failures == [], "Conversation line misalignment: " + "; ".join(alignment_failures)

    before = page.locator("#agent-layer .agent").evaluate_all(
        "agents => agents.map(agent => [agent.dataset.agentId, agent.style.left, agent.style.top]).sort((a, b) => Number(a[0]) - Number(b[0]))"
    )
    set_step(page, 8)
    set_step(page, 7)
    after = page.locator("#agent-layer .agent").evaluate_all(
        "agents => agents.map(agent => [agent.dataset.agentId, agent.style.left, agent.style.top]).sort((a, b) => Number(a[0]) - Number(b[0]))"
    )
    assert before == after, "Step 7 layout changed after timeline seek"
    page.locator("#speed-select").select_option("450")
    page.locator("#play-button").click()
    page.wait_for_timeout(600)
    assert page.locator("#timeline").input_value() == "7", "Auto timeline advanced before the Step dialogue finished"
    page.locator("#play-button").click()
    page.locator("#speed-select").select_option("900")
    return {
        "counts": counts,
        "conversations": 10,
        "conversingAgents": 20,
        "bubblePageSize": len(first_bubble_agents),
        "bubbleTurnMs": 1800,
    }


def assert_movement_modes(page: Page, screenshot: Path) -> dict[str, object]:
    movement_select = page.locator("#movement-mode")
    road_toggle = page.locator("#road-movement-button")
    assert movement_select.input_value() == "trail"
    assert road_toggle.get_attribute("aria-pressed") == "false"
    page.wait_for_timeout(1200)

    set_step(page, 8)
    trail_paths = page.locator("#movement-trails .movement-light-core").count()
    moving_agents = page.locator("#agent-layer .agent.is-moving").count()
    assert trail_paths > 0, "Adjacent Step did not create light trails"
    assert moving_agents > 0, "Agents did not animate between adjacent Steps"
    movement_screenshot = screenshot.with_name(f"{screenshot.stem}-movement{screenshot.suffix}")
    page.screenshot(path=str(movement_screenshot), full_page=True)
    page.wait_for_timeout(1200)
    assert page.locator("#movement-trails").locator("*").count() == 0

    road_toggle.click()
    assert road_toggle.get_attribute("aria-pressed") == "true"
    assert page.evaluate("() => localStorage.getItem('fromunknown2lover:road-movement:v1')") == "true"
    set_step(page, 9)
    road_paths = page.locator('#movement-trails .movement-light-core[data-route-mode="road"]')
    road_path_count = road_paths.count()
    assert road_path_count > 0, "Road routing did not produce an inter-venue road path"
    assert all(" L " in path.get_attribute("d") for path in road_paths.all())
    road_screenshot = screenshot.with_name(f"{screenshot.stem}-road-movement{screenshot.suffix}")
    page.screenshot(path=str(road_screenshot), full_page=True)
    page.wait_for_timeout(1200)

    movement_select.select_option("ghost")
    assert page.evaluate("() => localStorage.getItem('fromunknown2lover:movement-mode:v1')") == "ghost"
    set_step(page, 10)
    ghosts = page.locator("#movement-ghosts .movement-ghost")
    ghost_count = ghosts.count()
    assert ghost_count >= 3 and ghost_count % 3 == 0
    assert page.locator("#movement-trails").locator("*").count() == 0
    delays = ghosts.evaluate_all(
        "nodes => nodes.map(node => Number.parseFloat(node.style.getPropertyValue('--ghost-delay')))"
    )
    assert min(delays) >= 180, "A Ghost is scheduled before the Agent passes its position"
    early_opacity = ghosts.evaluate_all("nodes => nodes.map(node => getComputedStyle(node).opacity)")
    assert all(value == "0" for value in early_opacity), "A Ghost appeared ahead of the moving Agent"
    page.wait_for_timeout(1200)

    movement_select.select_option("off")
    set_step(page, 11)
    assert page.locator("#movement-layer").locator("*").count() == 2  # empty SVG and ghost containers
    assert page.locator("#agent-layer .agent.is-moving").count() == 0

    movement_select.select_option("trail")
    set_step(page, 13)
    assert page.locator("#movement-trails .movement-light-core").count() == 0, "Timeline jump invented a movement path"

    movement_select.select_option("normal")
    assert page.evaluate("() => localStorage.getItem('fromunknown2lover:movement-mode:v1')") == "normal"
    set_step(page, 12)
    normal_moving_agents = page.locator("#agent-layer .agent.is-moving").count()
    assert normal_moving_agents > 0, "Normal mode did not animate Agents"
    assert page.locator("#movement-layer").locator("*").count() == 2, "Normal mode rendered a trail or Ghost"
    return {
        "trailPaths": trail_paths,
        "movingAgents": moving_agents,
        "roadPaths": road_path_count,
        "ghosts": ghost_count,
        "ghostMinimumDelayMs": min(delays),
        "normalMovingAgents": normal_moving_agents,
        "jumpPaths": 0,
    }


def check_legacy_replay(page: Page, base_url: str) -> dict[str, object]:
    page.goto(f"{base_url}/?replay=demo.json", wait_until="networkidle")
    page.locator("#agent-layer .agent").first.wait_for()
    agent_count = page.locator("#agent-layer .agent").count()
    assert agent_count > 0
    assert page.locator('#agent-layer .agent[data-projection="global"]').count() == agent_count
    assert page.locator('#agent-layer .agent[data-gender="female"]').count() == 3
    assert page.locator('#agent-layer .agent[data-gender="male"]').count() == 3
    return {"agents": agent_count, "projection": "global", "genderStyles": {"female": 3, "male": 3}}


def check_viewer(page: Page, base_url: str, screenshot: Path) -> dict[str, object]:
    page.goto(f"{base_url}/?replay={REPLAY}", wait_until="networkidle")
    page.locator("#agent-layer .agent").first.wait_for()
    assert page.locator("html").get_attribute("lang") == "en"
    assert page.locator('[data-language="en"]').get_attribute("aria-pressed") == "true"
    assert page.locator(".editor-link").text_content() == "Map editor"
    cultural_label = page.locator('#map-layer [data-map-object-id="cultural"] .venue-label')
    assert cultural_label.text_content().strip() == "CULTURE"
    assert "文化" not in cultural_label.text_content()
    assert page.locator("#map-layer .non-simulation-badge").first.text_content() == "NON-SIMULATION VENUE"

    page.locator('[data-language="zh"]').click()
    assert page.locator("html").get_attribute("lang") == "zh-CN"
    assert page.locator(".editor-link").text_content() == "地图编辑器"
    assert cultural_label.text_content().strip() == "文化建筑CULTURE"
    assert page.evaluate("() => localStorage.getItem('fromunknown2lover:language')") == "zh"

    page.locator('[data-language="en"]').click()
    assert page.locator("html").get_attribute("lang") == "en"
    assert cultural_label.text_content().strip() == "CULTURE"
    assert page.locator("#agent-layer .agent").count() == 30
    assert page.locator('#agent-layer .agent[data-gender="female"]').count() == 15
    assert page.locator('#agent-layer .agent[data-gender="male"]').count() == 15
    assert page.locator('#agent-layer .agent .agent-sprite[data-sprite-id]').count() == 30
    assert page.locator('#agent-layer .agent[data-sprite-id="sprite-6"]').count() > 0
    assert page.locator('#agent-layer .agent .agent-sprite').first.evaluate(
        "element => getComputedStyle(element).backgroundImage.includes('kenney-rpg-urban/tilemap.png')"
    )
    known_bad_event = page.locator('.event-item[data-event-id="encounter-06-09-01-1"]')
    assert known_bad_event.locator(".event-stage").text_content() == "ACQUAINTANCE"
    warning_text = " ".join(known_bad_event.locator(".event-warning").all_text_contents())
    assert "Contact claim lacks dialogue evidence" in warning_text
    stage_box = assert_stage_ratio(page, "#world-stage")
    legend_box = assert_legend_does_not_cover_stage(page)
    set_step(page, 13)
    counts = replay_counts(page)
    assert counts == EXPECTED_STEP_13, f"Unexpected Step 13 distribution: {counts}"
    assert page.locator('#agent-layer .agent[data-map-object-id="residential"]').count() == 0
    assert page.locator("#map-layer .map-object.is-display-only").count() == 4
    assert page.locator("#map-layer .non-simulation-badge").count() == 4
    assert_agents_inside_mapped_objects(page)
    step_seven = assert_step_seven_dialogue_layout(page)
    movement = assert_movement_modes(page, screenshot)
    page.screenshot(path=str(screenshot), full_page=True)
    page.set_viewport_size({"width": 390, "height": 900})
    page.wait_for_timeout(100)
    mobile_stage = assert_stage_ratio(page, "#world-stage")
    assert_legend_does_not_cover_stage(page)
    assert_stage_fits_world(page)
    page.set_viewport_size({"width": 1440, "height": 1100})
    legacy = check_legacy_replay(page, base_url)
    return {"stage": stage_box, "legend": legend_box, "mobileStage": mobile_stage, "step13": counts, "step7": step_seven, "movement": movement, "legacyReplay": legacy}


def check_editor_and_draft(page: Page, base_url: str) -> dict[str, object]:
    page.goto(f"{base_url}/editor.html", wait_until="networkidle")
    page.locator('#editor-map-layer [data-map-object-id="night-school"]').wait_for()
    assert page.locator("html").get_attribute("lang") == "en"
    assert page.locator("h1").text_content() == "DISTRICT WORKSHOP"
    assert page.locator('#editor-map-layer [data-map-object-id="cultural"] .venue-label').text_content().strip() == "CULTURE"
    page.locator('[data-language="zh"]').click()
    assert page.locator("h1").text_content() == "街区拼装台"
    assert page.locator('#editor-map-layer [data-map-object-id="cultural"] .venue-label').text_content().strip() == "文化建筑CULTURE"
    page.locator('[data-language="en"]').click()
    editor_box = assert_stage_ratio(page, "#editor-world")
    page.locator('#editor-map-layer [data-map-object-id="night-school"]').click()
    assert page.locator("#field-simulation-status").input_value() == "mapped"
    assert page.locator("#field-source-building-id").input_value() == "night_school_building_01"
    page.locator("#field-x").fill("20")
    page.locator("#field-x").dispatch_event("change")
    page.wait_for_timeout(300)
    draft_x = page.evaluate(
        "() => JSON.parse(localStorage.getItem('fromunknown2lover:map-editor:draft:v2')).objects.find((object) => object.id === 'night-school').x"
    )
    assert draft_x == 20

    preview = page.context.new_page()
    preview.goto(f"{base_url}/?map=draft&replay={REPLAY}", wait_until="networkidle")
    preview.locator("#agent-layer .agent").first.wait_for()
    set_step(preview, 13)
    assert replay_counts(preview) == EXPECTED_STEP_13
    target_left = preview.locator('#map-layer [data-map-object-id="night-school"]').evaluate(
        "element => Number.parseFloat(element.style.left)"
    )
    assert abs(target_left - (20 / 240 * 100)) < 0.01
    assert_agents_inside_mapped_objects(preview)
    preview.close()
    return {"stage": editor_box, "movedNightSchoolX": draft_x}


def check_character_generator(page: Page, base_url: str, screenshot: Path) -> dict[str, object]:
    page.goto(f"{base_url}/characters.html?lang=en", wait_until="networkidle")
    page.locator("#character-preview-sprite").wait_for()
    assert page.locator(".series-card").count() == 6
    assert page.locator("#direction-controls button").count() == 4
    assert page.locator("#frame-controls button").count() == 3

    page.locator('.series-card[data-sprite-id="sprite-6"]').click()
    page.locator('#direction-controls button[data-direction="right"]').click()
    page.locator('#frame-controls button[data-frame="2"]').click()
    page.locator("#animate-character").uncheck()
    preview = page.locator("#character-preview-sprite")
    assert preview.get_attribute("data-sprite-id") == "sprite-6"
    assert preview.get_attribute("data-direction") == "right"
    assert preview.get_attribute("data-frame") == "2"
    assert preview.get_attribute("data-tile-index") == "485"
    generator_screenshot = screenshot.with_name(f"{screenshot.stem}-characters{screenshot.suffix}")
    page.screenshot(path=str(generator_screenshot), full_page=True)

    page.locator("#character-id").fill("2")
    page.locator("#character-name").fill("Custom Mia")
    page.locator("#save-character").click()
    assert page.locator(".roster-item").count() == 1

    page.goto(f"{base_url}/?replay=demo.json&lang=en", wait_until="networkidle")
    customized = page.locator('#agent-layer .agent[data-agent-id="2"]')
    customized.wait_for()
    assert customized.get_attribute("data-sprite-id") == "sprite-6"
    sprite = customized.locator(".agent-sprite")
    assert sprite.get_attribute("data-direction") == "right"
    assert sprite.get_attribute("data-frame") == "2"
    assert sprite.get_attribute("data-tile-index") == "485"
    return {"series": 6, "directions": 4, "frames": 3, "overrideAgentId": 2, "tileIndex": 485}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4174")
    parser.add_argument("--screenshot", type=Path, default=Path("/tmp/fromunknown2lover-metric-viewer.png"))
    args = parser.parse_args()
    console_errors: list[str] = []

    with sync_playwright() as playwright:
        executable = installed_chromium()
        browser = playwright.chromium.launch(headless=True, executable_path=str(executable) if executable else None)
        context = browser.new_context(viewport={"width": 1440, "height": 1100})
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))
        result = {
            "viewer": check_viewer(page, args.base_url.rstrip("/"), args.screenshot),
            "editor": check_editor_and_draft(page, args.base_url.rstrip("/")),
            "characterGenerator": check_character_generator(page, args.base_url.rstrip("/"), args.screenshot),
        }
        browser.close()

    assert console_errors == [], "Browser console errors: " + " | ".join(console_errors)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
