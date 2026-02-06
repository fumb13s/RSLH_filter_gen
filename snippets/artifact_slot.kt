interface HasId {
    val id: Int
}

enum class Slot: org.maurezen.HasId {
    WEAPON(5),
    HELMET(1),
    SHIELD(6),
    GLOVE(3),
    CHEST(2),
    BOOT(4),
    RING,
    AMULET,
    BANNER(9);
}