"""The cockpit shrinks to fit a short screen and is left alone on a tall one."""
from team_widget.fit import scale_for


def test_a_tall_screen_changes_nothing():
    assert scale_for(1032) == 1.0   # Marco's PC
    assert scale_for(800) == 1.0
    assert scale_for(None) == 1.0   # the screen could not be read


def test_a_short_screen_shrinks_enough_to_fit():
    for usable in (728, 700, 640, 790):   # a 768p laptop, ...
        scale = scale_for(usable)
        assert scale < 1.0 and 800 * scale <= usable or scale == 0.75


def test_never_too_small_to_read():
    assert scale_for(400) == 0.75


def test_the_mac_cockpit_is_shorter():
    assert scale_for(859, need=860) == 0.95
