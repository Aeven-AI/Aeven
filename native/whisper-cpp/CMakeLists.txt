# Build the private speech worker against a pinned whisper.cpp source tree (scripts/build.ts supplies WHISPER_SOURCE_DIR).
cmake_minimum_required(VERSION 3.21)
project(avn_whisper_worker C CXX)

set(WHISPER_SOURCE_DIR "" CACHE PATH "Extracted, hash-verified whisper.cpp source tree")
if(NOT EXISTS "${WHISPER_SOURCE_DIR}/include/whisper.h")
  message(FATAL_ERROR "WHISPER_SOURCE_DIR must point at an extracted whisper.cpp source tree")
endif()

add_subdirectory("${WHISPER_SOURCE_DIR}" whisper EXCLUDE_FROM_ALL)

add_executable(avn-whisper-worker src/worker.cpp)
target_compile_features(avn-whisper-worker PRIVATE cxx_std_17)
target_link_libraries(avn-whisper-worker PRIVATE whisper)
